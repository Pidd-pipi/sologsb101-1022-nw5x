import { db } from '@/utils/db'
import type { Material } from '@/types/material'
import type { Proportion } from '@/types/proportion'
import type { Batch, BatchSnapshotItem } from '@/types/batch'
import { buildMaterialMap, buildSnapshotItems, revisionOf, snapshotItemsEqual } from '@/utils/master'

/**
 * 主档一致性服务：把「改香料主档」「入窖锁定 / 解锁」这些跨表动作收敛到事务里。
 * - 主档改等级 / 炮制：修订号 +1，未入窖批次快照失效重算，已入窖批次锁住当时写法。
 * - 入窖：按当前配比 + 最新主档固化一次快照并锁定；删除窖藏后解锁，回到随主档重算。
 */

export interface MaterialChangeResult {
  /** 主档新修订号 */
  revision: number
  /** 是否因等级 / 炮制改动而抬了修订号 */
  writingChanged: boolean
  /** 因主档改动而失效重算的未入窖批次数 */
  recalcedBatches: number
}

/** 读取一批香方涉及的全部未入窖批次 */
async function unlockedBatchesOfFormulas(formulaIds: Set<string>): Promise<Batch[]> {
  if (formulaIds.size === 0) return []
  const batches = await db.batches.where('formulaId').anyOf([...formulaIds]).toArray()
  return batches.filter((batch) => !batch.locked)
}

/**
 * 用当前配比 + 最新主档重算未入窖批次快照；内容没变的不写，避免无谓的更新时间抖动。
 * 返回实际重写的批次数。
 */
export async function recalcUnlockedBatches(formulaIds?: string[]): Promise<number> {
  const allMaterials = await db.materials.toArray()
  const materialMap = buildMaterialMap(allMaterials)
  const allProportions = await db.proportions.toArray()
  const proportionsByFormula = new Map<string, Proportion[]>()
  allProportions.forEach((proportion) => {
    const list = proportionsByFormula.get(proportion.formulaId) ?? []
    list.push(proportion)
    proportionsByFormula.set(proportion.formulaId, list)
  })

  let batches: Batch[]
  if (formulaIds && formulaIds.length > 0) {
    batches = await unlockedBatchesOfFormulas(new Set(formulaIds))
  } else {
    batches = (await db.batches.toArray()).filter((batch) => !batch.locked)
  }
  if (batches.length === 0) return 0

  const now = Date.now()
  let changed = 0
  await db.transaction('rw', db.batches, async () => {
    for (const batch of batches) {
      const proportions = proportionsByFormula.get(batch.formulaId) ?? []
      const next: BatchSnapshotItem[] = buildSnapshotItems(proportions, materialMap)
      if (snapshotItemsEqual(batch.snapshot, next)) continue
      await db.batches.update(batch.id, { snapshot: next, snapshotAt: now, updatedAt: now })
      changed += 1
    }
  })
  return changed
}

/**
 * 更新香料主档。等级 / 炮制方式改动时修订号 +1，
 * 并把引用它的未入窖批次快照按当前配比与最新主档重算；已入窖批次不动。
 */
export async function applyMaterialUpdate(id: string, patch: Partial<Material>): Promise<MaterialChangeResult> {
  const writingChanged = patch.grade !== undefined || patch.processMethod !== undefined
  return db.transaction('rw', [db.materials, db.proportions, db.batches], async () => {
    const current = await db.materials.get(id)
    if (!current) throw new Error('香料不存在或已被删除')
    const revision = writingChanged ? revisionOf(current) + 1 : revisionOf(current)
    const now = Date.now()
    const nextMaterial: Material = { ...current, ...patch, revision, updatedAt: now }
    await db.materials.put(nextMaterial)

    // 找出引用该香料的配比所属香方，再重算这些香方下的未入窖批次快照
    const proportions = await db.proportions.where('materialId').equals(id).toArray()
    const formulaIds = new Set(proportions.map((proportion) => proportion.formulaId))
    let recalcedBatches = 0
    if (formulaIds.size > 0) {
      const materialMap = buildMaterialMap(await db.materials.toArray())
      const proportionsByFormula = new Map<string, Proportion[]>()
      ;(await db.proportions.toArray()).forEach((proportion) => {
        if (!formulaIds.has(proportion.formulaId)) return
        const list = proportionsByFormula.get(proportion.formulaId) ?? []
        list.push(proportion)
        proportionsByFormula.set(proportion.formulaId, list)
      })
      const batches = await unlockedBatchesOfFormulas(formulaIds)
      for (const batch of batches) {
        const list = proportionsByFormula.get(batch.formulaId) ?? []
        const next = buildSnapshotItems(list, materialMap)
        if (snapshotItemsEqual(batch.snapshot, next)) continue
        await db.batches.update(batch.id, { snapshot: next, snapshotAt: now, updatedAt: now })
        recalcedBatches += 1
      }
    }
    return { revision, writingChanged, recalcedBatches }
  })
}

/**
 * 删除香料：级联删除引用它的配比，并重算相关未入窖批次快照（该味随之移出）。
 * 已入窖批次不动，快照里保留当时写法。
 */
export async function applyMaterialRemoval(
  id: string
): Promise<{ proportions: number; formulaIds: string[]; recalcedBatches: number }> {
  return db.transaction('rw', [db.materials, db.proportions, db.batches], async () => {
    const proportions = await db.proportions.where('materialId').equals(id).toArray()
    const proportionIds = proportions.map((item) => item.id)
    const formulaIds = Array.from(new Set(proportions.map((item) => item.formulaId)))
    await db.proportions.bulkDelete(proportionIds)
    await db.materials.delete(id)

    let recalcedBatches = 0
    if (formulaIds.length > 0) {
      const materialMap = buildMaterialMap(await db.materials.toArray())
      const remaining = await db.proportions.where('formulaId').anyOf(formulaIds).toArray()
      const byFormula = new Map<string, Proportion[]>()
      remaining.forEach((proportion) => {
        const list = byFormula.get(proportion.formulaId) ?? []
        list.push(proportion)
        byFormula.set(proportion.formulaId, list)
      })
      const batches = await unlockedBatchesOfFormulas(new Set(formulaIds))
      const now = Date.now()
      for (const batch of batches) {
        const next = buildSnapshotItems(byFormula.get(batch.formulaId) ?? [], materialMap)
        await db.batches.update(batch.id, { snapshot: next, snapshotAt: now, updatedAt: now })
        recalcedBatches += 1
      }
    }
    return { proportions: proportionIds.length, formulaIds, recalcedBatches }
  })
}

/**
 * 入窖锁定：按当前配比 + 最新主档固化快照后加锁，此后主档再改也不重算。
 * 已锁定则直接返回（幂等，支持一批次多次窖藏登记）。
 */
export async function lockBatchSnapshot(batchId: string): Promise<boolean> {
  return db.transaction('rw', [db.batches, db.proportions, db.materials], async () => {
    const batch = await db.batches.get(batchId)
    if (!batch) return false
    if (batch.locked) return false
    const now = Date.now()
    const [proportions, materials] = await Promise.all([
      db.proportions.where('formulaId').equals(batch.formulaId).toArray(),
      db.materials.toArray()
    ])
    const snapshot = buildSnapshotItems(proportions, buildMaterialMap(materials))
    await db.batches.update(batchId, { locked: true, lockedAt: now, snapshot, snapshotAt: now, updatedAt: now })
    return true
  })
}

/**
 * 解锁批次（窖藏记录全部删除后调用）：清掉锁定标记，
 * 并按当前配比 + 最新主档重算快照，回到「随主档失效重算」状态。
 */
export async function unlockBatchSnapshot(batchId: string): Promise<boolean> {
  return db.transaction('rw', [db.batches, db.proportions, db.materials, db.cellars], async () => {
    const batch = await db.batches.get(batchId)
    if (!batch) return false
    const remainingCellars = await db.cellars.where('batchId').equals(batchId).count()
    if (remainingCellars > 0) return false
    if (!batch.locked) return false
    const now = Date.now()
    const [proportions, materials] = await Promise.all([
      db.proportions.where('formulaId').equals(batch.formulaId).toArray(),
      db.materials.toArray()
    ])
    const snapshot = buildSnapshotItems(proportions, buildMaterialMap(materials))
    await db.batches.update(batchId, { locked: false, lockedAt: 0, snapshot, snapshotAt: now, updatedAt: now })
    return true
  })
}

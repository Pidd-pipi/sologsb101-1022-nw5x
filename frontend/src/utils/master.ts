import { db } from '@/utils/db'
import { INITIAL_MATERIAL_REV, type Material } from '@/types/material'
import type { Proportion } from '@/types/proportion'
import type { BatchSnapshotItem } from '@/types/batch'

/**
 * 主档（香料库）修订与快照联动。
 *
 * 规则：
 * - 仅「等级 / 炮制方式」变化推进 Material.rev；名称、产地、香气等变化不推进。
 * - rev 推进时，同事务内把引用它的未固化配比 materialRev 推到最新，
 *   未入窖批次快照里该味的等级/炮制/修订号按最新主档重算；
 *   已入窖批次（cellars 表存在对应记录）跳过，锁住入窖当时写法。
 * - 改名时仅同步未入窖快照里的香材名，等级/炮制与 rev 不动。
 */

/** 主档被另一处（如另一个开着的页面）改过：保存方拿着旧修订号时抛此错，页面保留草稿引导重试 */
export class MasterConflictError extends Error {
  materialId: string
  expectedRev: number
  actualRev: number

  constructor(materialId: string, expectedRev: number, actualRev: number) {
    super(`香料主档已被别处改动（修订号 ${expectedRev} → ${actualRev}），已按最新主档重算，请确认后带草稿重试`)
    this.name = 'MasterConflictError'
    this.materialId = materialId
    this.expectedRev = expectedRev
    this.actualRev = actualRev
  }
}

export function isMasterConflictError(err: unknown): err is MasterConflictError {
  return err instanceof MasterConflictError
}

/** 判定本次更新是否涉及会推进修订号的字段 */
export function isRevisionBump(patch: Partial<Material>, current: Material): boolean {
  return (
    (patch.grade !== undefined && patch.grade !== current.grade) ||
    (patch.processMethod !== undefined && patch.processMethod !== current.processMethod)
  )
}

/** 由配比与主档组装一条快照（主档缺失时退回占位写法，不阻断和香登记） */
export function toSnapshotItem(
  proportion: Pick<Proportion, 'materialId' | 'ratio' | 'role'>,
  material: Material | undefined
): BatchSnapshotItem {
  return {
    materialId: proportion.materialId,
    materialName: material?.name ?? '未知香料',
    ratio: proportion.ratio,
    role: proportion.role,
    grade: material?.grade ?? '—',
    processMethod: material?.processMethod ?? '—',
    materialRev: material?.rev ?? INITIAL_MATERIAL_REV
  }
}

/** 按当前配比与最新主档构建整方快照（seq 升序），登记和香批次时调用 */
export async function buildSnapshotItems(formulaId: string): Promise<BatchSnapshotItem[]> {
  const proportions = await db.proportions.where('formulaId').equals(formulaId).toArray()
  if (proportions.length === 0) return []
  const materials = await db.materials.where('id').anyOf(proportions.map((item) => item.materialId)).toArray()
  const materialMap = new Map<string, Material>(materials.map((material) => [material.id, material]))
  return proportions
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((proportion) => toSnapshotItem(proportion, materialMap.get(proportion.materialId)))
}

/** 已入窖（存在窖藏记录）的批次 id 集合，入窖即锁快照 */
export async function lockedBatchIds(): Promise<Set<string>> {
  const cellars = await db.cellars.toArray()
  return new Set(cellars.map((cellar) => cellar.batchId))
}

export interface MaterialCascadeResult {
  /** 落库后的最新主档 */
  material: Material
  /** 本次是否推进了修订号 */
  revBumped: boolean
  /** 联动推进的未固化配比条数 */
  proportions: number
  /** 联动重算的未入窖批次数 */
  batches: number
  /** 因已入窖而锁住写法、跳过未重算的批次数 */
  lockedBatches: number
}

/**
 * 主档更新唯一入口：等级/炮制变更时联动失效重算。
 * expectedRev 由编辑表单带入（开弹窗时看到的修订号），与当前值不符则抛 MasterConflictError，
 * 调用方保留草稿并可用最新修订号重试。
 */
export async function updateMaterialWithCascade(
  id: string,
  patch: Partial<Material> & { expectedRev?: number }
): Promise<MaterialCascadeResult> {
  const { expectedRev, ...fields } = patch
  return db.transaction(
    'rw',
    [db.materials, db.proportions, db.batches, db.cellars],
    async (): Promise<MaterialCascadeResult> => {
      const current = await db.materials.get(id)
      if (!current) throw new Error('香料不存在或已被删除')
      const revBump = isRevisionBump(fields, current)
      if (revBump && expectedRev !== undefined && expectedRev !== current.rev) {
        throw new MasterConflictError(id, expectedRev, current.rev)
      }
      const now = Date.now()
      const nextRev = revBump ? current.rev + 1 : current.rev
      const material: Material = { ...current, ...fields, rev: nextRev, updatedAt: now }
      await db.materials.put(material)

      let proportionCount = 0
      if (revBump) {
        const affected = await db.proportions.where('materialId').equals(id).toArray()
        proportionCount = affected.length
        if (affected.length > 0) {
          await db.proportions.where('materialId').equals(id).modify((proportion) => {
            proportion.materialRev = nextRev
            proportion.updatedAt = now
          })
        }
      }

      let batchCount = 0
      let lockedCount = 0
      const renamed = typeof fields.name === 'string' && fields.name.trim() !== current.name ? fields.name.trim() : null
      if (revBump || renamed) {
        const lockedIds = await lockedBatchIds()
        await db.batches.toCollection().modify((batch) => {
          if (!batch.snapshot.some((item) => item.materialId === id)) return
          if (lockedIds.has(batch.id)) {
            lockedCount += 1
            return
          }
          let touched = false
          batch.snapshot = batch.snapshot.map((item) => {
            if (item.materialId !== id) return item
            touched = true
            return {
              ...item,
              materialName: renamed ?? item.materialName,
              grade: revBump ? material.grade : item.grade,
              processMethod: revBump ? material.processMethod : item.processMethod,
              materialRev: revBump ? nextRev : item.materialRev
            }
          })
          if (touched) {
            batch.updatedAt = now
            batchCount += 1
          }
        })
      }

      return { material, revBumped: revBump, proportions: proportionCount, batches: batchCount, lockedBatches: lockedCount }
    }
  )
}

/**
 * 入窖前把批次快照按最新主档再刷一遍写法（占比/角色保持和香当时实际值不变），
 * 随后该批次因存在窖藏记录而被锁定。主档已删除的条目保留原写法。
 */
export async function stampSnapshotOnCellar(batchId: string): Promise<boolean> {
  return db.transaction('rw', [db.batches, db.materials, db.cellars], async () => {
    const batch = await db.batches.get(batchId)
    if (!batch || !Array.isArray(batch.snapshot) || batch.snapshot.length === 0) return false
    const materialIds = Array.from(new Set(batch.snapshot.map((item) => item.materialId)))
    const materials = await db.materials.where('id').anyOf(materialIds).toArray()
    const materialMap = new Map<string, Material>(materials.map((item) => [item.id, item]))
    let stamped = false
    batch.snapshot = batch.snapshot.map((item) => {
      const material = materialMap.get(item.materialId)
      if (!material) return item
      if (
        item.materialName === material.name &&
        item.grade === material.grade &&
        item.processMethod === material.processMethod &&
        item.materialRev === material.rev
      ) {
        return item
      }
      stamped = true
      return {
        ...item,
        materialName: material.name,
        grade: material.grade,
        processMethod: material.processMethod,
        materialRev: material.rev
      }
    })
    if (stamped) {
      batch.updatedAt = Date.now()
      await db.batches.put(batch)
    }
    return stamped
  })
}

/** 单条配比保存前的乐观并发校验：草稿打开后该香料主档若已升版则拒绝，交由页面带草稿重试 */
export async function assertMaterialAtRev(materialId: string, expectedRev: number): Promise<Material> {
  const material = await db.materials.get(materialId)
  if (!material) throw new Error('香料不存在或已被删除')
  if (material.rev !== expectedRev) {
    throw new MasterConflictError(materialId, expectedRev, material.rev)
  }
  return material
}

/**
 * 窖藏记录被删除、批次重新回到未入窖状态时，把其快照的香材写法（名称/等级/炮制/rev）
 * 重新对齐最新主档；占比与角色仍保留和香当时值，已删除主档的条目保持原写法不动。
 */
export async function resyncSnapshotToMaster(batchId: string): Promise<boolean> {
  return db.transaction('rw', [db.batches, db.materials], async () => {
    const batch = await db.batches.get(batchId)
    if (!batch || !Array.isArray(batch.snapshot) || batch.snapshot.length === 0) return false
    const materialIds = Array.from(new Set(batch.snapshot.map((item) => item.materialId)))
    const materials = await db.materials.where('id').anyOf(materialIds).toArray()
    const materialMap = new Map<string, Material>(materials.map((item) => [item.id, item]))
    let touched = false
    batch.snapshot = batch.snapshot.map((item) => {
      const material = materialMap.get(item.materialId)
      if (!material) return item
      if (
        item.materialName === material.name &&
        item.grade === material.grade &&
        item.processMethod === material.processMethod &&
        item.materialRev === material.rev
      ) {
        return item
      }
      touched = true
      return {
        ...item,
        materialName: material.name,
        grade: material.grade,
        processMethod: material.processMethod,
        materialRev: material.rev
      }
    })
    if (touched) {
      batch.updatedAt = Date.now()
      await db.batches.put(batch)
    }
    return touched
  })
}

/** 供 v3 升级与导入规范化使用：把缺失修订号的历史记录按当前值回填 */
export function normalizeMaterialRev(material: Partial<Material>): number {
  return typeof material.rev === 'number' && Number.isFinite(material.rev) && material.rev > 0
    ? material.rev
    : INITIAL_MATERIAL_REV
}

/** 历史快照条目补齐等级/炮制/修订号：有主档按当前值，无主档按占位值 */
export function normalizeSnapshotItem(item: Partial<BatchSnapshotItem>, material?: Material): BatchSnapshotItem {
  return {
    materialId: String(item.materialId ?? ''),
    materialName: typeof item.materialName === 'string' ? item.materialName : material?.name ?? '未知香料',
    ratio: typeof item.ratio === 'number' ? item.ratio : 0,
    role: typeof item.role === 'string' ? item.role : '君',
    grade: material?.grade ?? (typeof item.grade === 'string' ? item.grade : '—'),
    processMethod:
      material?.processMethod ?? (typeof item.processMethod === 'string' ? item.processMethod : '—'),
    materialRev: material?.rev ?? (typeof item.materialRev === 'number' ? item.materialRev : INITIAL_MATERIAL_REV)
  }
}

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { db } from '@/utils/db'
import { useProportionStore } from '@/stores/proportionStore'
import { useFormulaStore } from '@/stores/formulaStore'
import { useMaterialStore } from '@/stores/materialStore'
import type { Proportion, ProportionRole } from '@/types/proportion'
import type { Material, MaterialGrade, ProcessMethod } from '@/types/material'
import { revisionOf } from '@/utils/master'
import {
  applyManualOrder,
  checkRatioTotal,
  diffFromHundred,
  nextSeqMap,
  normalizeRatios,
  round,
  scaleRatios,
  sortByRoleWeight
} from '@/utils/ratio'

export interface UseProportionOptions {
  /** 仅在该香方下操作；不传则使用 formulaStore 的当前香方 */
  formulaId?: Ref<string | null>
}

export interface ProportionFormPayload {
  materialId: string
  ratio: number
  role: ProportionRole
  note: string
  /** 表单打开时看到的主档修订号：与最新主档不一致则保存冲突，保留草稿重试 */
  baseMaterialRevision?: number
}

/** 配比页一行：配比 + 香料快照 */
export interface ProportionRow {
  /** 配比主键，便于统一按 id 排序 / 拖拽 */
  id: string
  proportion: Proportion
  material: Material | null
  materialName: string
  origin: string
  grade: MaterialGrade | '未知'
  processMethod: ProcessMethod | '未知'
  ratio: number
  role: ProportionRole
  /** 配比行绑定的主档修订号 */
  materialRevision: number
  /** 主档当前修订号 */
  currentRevision: number
  /** 主档是否已在别处改过等级 / 炮制（这行配比停在旧写法上） */
  stale: boolean
}

export interface UseProportionResult {
  formulaId: ComputedRef<string | null>
  rows: ComputedRef<ProportionRow[]>
  /** 按君臣佐使权重预览排序结果（不改动数据库） */
  rolePreview: ComputedRef<ProportionRow[]>
  total: ComputedRef<number>
  gap: ComputedRef<number>
  balanced: ComputedRef<boolean>
  checkLevel: ComputedRef<'ok' | 'warn' | 'error'>
  checkMessage: ComputedRef<string>
  loading: Ref<boolean>
  error: Ref<string | null>
  add: (payload: ProportionFormPayload) => Promise<Proportion>
  update: (id: string, patch: Partial<ProportionFormPayload>) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 一键等比缩放到合计 100（可指定缩放因子） */
  rescale: (factor?: number) => Promise<number>
  /** 一键等比放大 / 缩小 */
  multiply: (factor: number) => Promise<number>
  /** 按君臣佐使权重重排并回写 seq */
  sortByRole: () => Promise<void>
  /** 拖拽后按新顺序回写 seq */
  reorder: (orderedIds: string[]) => Promise<void>
  /** 归一化到 100 并写回 */
  normalize: () => Promise<void>
  clearFormula: () => Promise<number>
}

/**
 * useProportion：管理某香方配比的增删改、合计校验与等比缩放。
 * 结果写回 Dexie，并通过 proportionStore 的 liveQuery 自动刷新页面。
 */
export function useProportion(options: UseProportionOptions = {}): UseProportionResult {
  const proportionStore = useProportionStore()
  const formulaStore = useFormulaStore()
  const materialStore = useMaterialStore()

  const loading = ref(false)
  const error = ref<string | null>(null)

  const formulaId = computed<string | null>(() =>
    options.formulaId ? options.formulaId.value : formulaStore.currentFormulaId
  )

  const rows = computed<ProportionRow[]>(() => {
    const id = formulaId.value
    if (!id) return []
    const materialMap = new Map<string, Material>()
    materialStore.materials.forEach((material) => materialMap.set(material.id, material))
    const list = proportionStore.proportionsByFormula(id).map<ProportionRow>((proportion) => {
      const material = materialMap.get(proportion.materialId) ?? null
      const currentRevision = revisionOf(material)
      const materialRevision =
        Number.isFinite(proportion.materialRevision) && proportion.materialRevision > 0
          ? proportion.materialRevision
          : currentRevision
      return {
        id: proportion.id,
        proportion,
        material,
        materialName: material?.name ?? '香料已删除',
        origin: material?.origin ?? '—',
        grade: material?.grade ?? '未知',
        processMethod: material?.processMethod ?? '未知',
        ratio: proportion.ratio,
        role: proportion.role,
        materialRevision,
        currentRevision,
        // 未固化配比永远按最新主档渲染；修订号落后只用于提示这行停在旧写法
        stale: material !== null && materialRevision !== currentRevision
      }
    })
    const orderedIds = [...list]
      .sort((a, b) => a.proportion.seq - b.proportion.seq)
      .map((row) => row.proportion.id)
    return applyManualOrder(list, orderedIds)
  })

  const rolePreview = computed<ProportionRow[]>(() => sortByRoleWeight(rows.value))

  const totals = computed(() => checkRatioTotal(rows.value.map((row) => row.ratio)))
  const total = computed(() => totals.value.total)
  const gap = computed(() => diffFromHundred(total.value))
  const balanced = computed(() => totals.value.balanced)
  const checkLevel = computed(() => totals.value.level)
  const checkMessage = computed(() => totals.value.message)

  /** 配比变化后把合计回写到香方，供香方台账与批次页读取 */
  async function syncFormulaTotal(): Promise<void> {
    const id = formulaId.value
    if (!id) return
    const current = await db.formulas.get(id)
    if (!current || current.totalRatio === total.value) return
    await db.formulas.update(id, { totalRatio: total.value, updatedAt: Date.now() })
  }

  watch(total, () => {
    void syncFormulaTotal()
  })

  function nextSeq(id: string): number {
    const list = proportionStore.proportionsByFormula(id)
    return list.length === 0 ? 1 : Math.max(...list.map((item) => item.seq)) + 1
  }

  async function add(payload: ProportionFormPayload): Promise<Proportion> {
    const id = formulaId.value
    if (!id) throw new Error('请先选择香方')
    loading.value = true
    try {
      const record = await proportionStore.createProportion({
        formulaId: id,
        materialId: payload.materialId,
        ratio: round(payload.ratio, 2),
        role: payload.role,
        note: payload.note.trim(),
        seq: nextSeq(id),
        baseMaterialRevision: payload.baseMaterialRevision
      })
      await syncFormulaTotal()
      return record
    } catch (err) {
      error.value = err instanceof Error ? err.message : '新增配比失败'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function update(id: string, patch: Partial<ProportionFormPayload>): Promise<void> {
    loading.value = true
    try {
      const next: Partial<Proportion> = {}
      if (patch.materialId !== undefined) next.materialId = patch.materialId
      if (patch.ratio !== undefined) next.ratio = round(patch.ratio, 2)
      if (patch.role !== undefined) next.role = patch.role
      if (patch.note !== undefined) next.note = patch.note.trim()
      // 带修订号的保存做乐观并发校验；只改占比 / 备注的就地编辑不传，直接跟随最新主档
      await proportionStore.updateProportion(id, next, patch.baseMaterialRevision)
      await syncFormulaTotal()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '更新配比失败'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function remove(id: string): Promise<void> {
    await proportionStore.removeProportion(id)
    await syncFormulaTotal()
  }

  async function writeRatios(ids: string[], ratios: number[]): Promise<void> {
    const now = Date.now()
    await db.transaction('rw', db.proportions, async () => {
      for (let index = 0; index < ids.length; index += 1) {
        await db.proportions.update(ids[index], { ratio: round(ratios[index] ?? 0, 2), updatedAt: now })
      }
    })
  }

  /** 等比缩放：按 factor 缩放全部占比后归一化到 100 并写回 */
  async function rescale(factor = 1): Promise<number> {
    const list = rows.value
    if (list.length === 0) return 0
    const scaled =
      factor === 1
        ? normalizeRatios(list.map((row) => row.ratio))
        : scaleRatios(list.map((row) => row.ratio), factor)
    await writeRatios(
      list.map((row) => row.proportion.id),
      scaled
    )
    await syncFormulaTotal()
    return scaled.length
  }

  async function multiply(factor: number): Promise<number> {
    return rescale(factor)
  }

  /** 按君臣佐使权重重排：写回 seq 并切换排序方式 */
  async function sortByRole(): Promise<void> {
    const sorted = sortByRoleWeight(rows.value.map((row) => row.proportion))
    await reorder(sorted.map((item) => item.id))
    proportionStore.setSortMode('role')
  }

  /** 拖拽排序：按传入的 id 顺序回写 seq */
  async function reorder(orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return
    const seqMap = nextSeqMap(orderedIds)
    const now = Date.now()
    await db.transaction('rw', db.proportions, async () => {
      for (const id of orderedIds) {
        await db.proportions.update(id, { seq: seqMap[id], updatedAt: now })
      }
    })
    proportionStore.setSortMode('manual')
  }

  async function normalize(): Promise<void> {
    await rescale(1)
  }

  async function clearFormula(): Promise<number> {
    const id = formulaId.value
    if (!id) return 0
    const count = await proportionStore.clearFormulaProportions(id)
    await syncFormulaTotal()
    return count
  }

  return {
    formulaId,
    rows,
    rolePreview,
    total,
    gap,
    balanced,
    checkLevel,
    checkMessage,
    loading,
    error,
    add,
    update,
    remove,
    rescale,
    multiply,
    sortByRole,
    reorder,
    normalize,
    clearFormula
  }
}

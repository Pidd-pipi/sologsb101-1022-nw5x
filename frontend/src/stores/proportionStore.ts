import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db, readUiPrefs, writeUiPrefs } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import {
  createEmptyProportionFilter,
  PROPORTION_ROLES,
  type Proportion,
  type ProportionFilterState,
  type ProportionRole,
  type RatioCheck
} from '@/types/proportion'
import { checkRatioTotal, round, sortByRoleWeight, sumRatios } from '@/utils/ratio'
import { MasterConflictError, revisionOf } from '@/utils/master'

/** 当前配比草稿行的校验结果 */
export interface ProportionDraftCheck {
  proportionId: string
  /** 单行占比是否合法（0 ~ 100） */
  valid: boolean
  message: string
}

/**
 * 配比 store：维护配比草稿、合计校验结果与排序方式。
 * 页面只读 store，跨页（配比页 ↔ 批次页 ↔ 香方页）状态都落在这里。
 */
export const useProportionStore = defineStore('proportion', () => {
  const proportionTable = useIdbTable<Proportion>((database) => database.proportions, {
    sortByUpdatedAt: false
  })

  const prefs = readUiPrefs()
  const sortMode = ref<'manual' | 'role'>(prefs.proportionSort)
  const filter = ref<ProportionFilterState>(createEmptyProportionFilter())
  /** 表单中的临时草稿（未落库），用于实时合计校验 */
  const draft = ref<Proportion[]>([])
  const selectedIds = ref<string[]>([])
  const lastError = ref<string | null>(null)

  const proportions = computed<Proportion[]>(() => proportionTable.rows.value)
  const loading = computed(() => proportionTable.loading.value)
  const ready = computed(() => proportionTable.ready.value)
  const error = computed(() => proportionTable.error.value)

  /** 按香方分组的配比，seq 升序 */
  const proportionsByFormulaMap = computed<Record<string, Proportion[]>>(() => {
    const grouped: Record<string, Proportion[]> = {}
    proportions.value.forEach((proportion) => {
      const list = grouped[proportion.formulaId] ?? []
      list.push(proportion)
      grouped[proportion.formulaId] = list
    })
    Object.values(grouped).forEach((list) => list.sort((a, b) => a.seq - b.seq))
    return grouped
  })

  /** 香方 id → 配比条数，供香方台账卡片回显 */
  const materialCountMap = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    Object.entries(proportionsByFormulaMap.value).forEach(([formulaId, list]) => {
      map[formulaId] = list.length
    })
    return map
  })

  /** 香方 id → 配比合计 */
  const totalByFormula = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    Object.entries(proportionsByFormulaMap.value).forEach(([formulaId, list]) => {
      map[formulaId] = sumRatios(list.map((item) => item.ratio))
    })
    return map
  })

  const roleCounts = computed<Record<ProportionRole, number>>(() => {
    const counts: Record<ProportionRole, number> = { 君: 0, 臣: 0, 佐: 0, 使: 0 }
    proportions.value.forEach((proportion) => {
      counts[proportion.role] += 1
    })
    return counts
  })

  function proportionsByFormula(formulaId: string): Proportion[] {
    return proportionsByFormulaMap.value[formulaId] ?? []
  }

  /** 实时校验某香方的配比合计（读库中数据） */
  function checkFormula(formulaId: string): RatioCheck {
    return checkRatioTotal(proportionsByFormula(formulaId).map((item) => item.ratio))
  }

  /** 实时校验草稿数组的合计（表单未提交时使用） */
  function checkDraft(ratios: number[]): RatioCheck {
    return checkRatioTotal(ratios)
  }

  /** 逐行校验：占比范围与角色是否合法 */
  function validateDrafts(list: Proportion[]): ProportionDraftCheck[] {
    return list.map((item) => {
      if (!Number.isFinite(item.ratio) || item.ratio <= 0) {
        return { proportionId: item.id, valid: false, message: '占比需大于 0' }
      }
      if (item.ratio > 100) {
        return { proportionId: item.id, valid: false, message: '单味占比不得超过 100%' }
      }
      if (!PROPORTION_ROLES.includes(item.role)) {
        return { proportionId: item.id, valid: false, message: '君臣佐使定位非法' }
      }
      return { proportionId: item.id, valid: true, message: '正常' }
    })
  }

  /** 当前草稿合计校验结果（配比表单消费） */
  const draftCheck = computed<RatioCheck>(() => checkRatioTotal(draft.value.map((item) => item.ratio)))

  const hasFilter = computed(
    () =>
      filter.value.keyword.trim().length > 0 ||
      filter.value.roles.length > 0 ||
      filter.value.grades.length > 0
  )

  function patchFilter(patch: Partial<ProportionFilterState>): void {
    filter.value = { ...filter.value, ...patch }
  }

  function resetFilter(): void {
    filter.value = createEmptyProportionFilter()
  }

  function setDraft(list: Proportion[]): void {
    draft.value = list.map((item) => ({ ...item, ratio: round(item.ratio, 2) }))
  }

  function pushDraft(item: Proportion): void {
    draft.value = [...draft.value, { ...item, ratio: round(item.ratio, 2) }]
  }

  function patchDraft(id: string, patch: Partial<Proportion>): void {
    draft.value = draft.value.map((item) => (item.id === id ? { ...item, ...patch } : item))
  }

  function removeDraft(id: string): void {
    draft.value = draft.value.filter((item) => item.id !== id)
  }

  function clearDraft(): void {
    draft.value = []
  }

  function setSortMode(mode: 'manual' | 'role'): void {
    sortMode.value = mode
    writeUiPrefs({ ...readUiPrefs(), proportionSort: mode })
  }

  function setSelection(ids: string[]): void {
    selectedIds.value = ids
  }

  function toggleSelection(id: string): void {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((item) => item !== id)
      : [...selectedIds.value, id]
  }

  /** 按当前排序方式整理某香方的配比（不改动数据库） */
  function sortedProportions(formulaId: string): Proportion[] {
    const list = proportionsByFormula(formulaId)
    return sortMode.value === 'role' ? sortByRoleWeight(list) : [...list].sort((a, b) => a.seq - b.seq)
  }

  async function createProportion(payload: {
    formulaId: string
    materialId: string
    ratio: number
    role: ProportionRole
    note: string
    seq?: number
    /** 表单打开时看到的主档修订号，用于乐观并发校验 */
    baseMaterialRevision?: number
  }): Promise<Proportion> {
    const list = proportionsByFormula(payload.formulaId)
    try {
      const material = await db.materials.get(payload.materialId)
      const currentRevision = revisionOf(material)
      if (
        payload.baseMaterialRevision !== undefined &&
        material &&
        payload.baseMaterialRevision !== currentRevision
      ) {
        throw new MasterConflictError({
          materialId: payload.materialId,
          expectedRevision: payload.baseMaterialRevision,
          actualRevision: currentRevision,
          latest: material ?? null
        })
      }
      return await proportionTable.create(
        {
          formulaId: payload.formulaId,
          materialId: payload.materialId,
          ratio: round(payload.ratio, 2),
          role: payload.role,
          note: payload.note,
          seq: payload.seq ?? (list.length === 0 ? 1 : Math.max(...list.map((item) => item.seq)) + 1),
          materialRevision: currentRevision
        },
        'prop'
      )
    } catch (err) {
      if (err instanceof MasterConflictError) throw err
      lastError.value = err instanceof Error ? err.message : '新增配比失败'
      throw err
    }
  }

  /**
   * 更新配比。传 baseMaterialRevision 时做乐观并发校验：
   * 另一页面已改主档导致修订号前移，则抛 MasterConflictError，草稿保留在表单里可重试。
   */
  async function updateProportion(
    id: string,
    patch: Partial<Proportion>,
    baseMaterialRevision?: number
  ): Promise<void> {
    if (baseMaterialRevision !== undefined) {
      const existing = await db.proportions.get(id)
      if (existing) {
        const material = await db.materials.get(existing.materialId)
        const currentRevision = revisionOf(material)
        if (baseMaterialRevision !== currentRevision) {
          throw new MasterConflictError({
            materialId: existing.materialId,
            expectedRevision: baseMaterialRevision,
            actualRevision: currentRevision,
            latest: material ?? null
          })
        }
      }
    }
    const next: Partial<Proportion> = { ...patch }
    // 正常保存即把这行配比对齐到最新主档修订号（未固化配比永远跟随最新主档）
    if (patch.materialRevision === undefined) {
      const existing = await db.proportions.get(id)
      if (existing) {
        const material = await db.materials.get(existing.materialId)
        if (material) next.materialRevision = revisionOf(material)
      }
    }
    await proportionTable.update(id, next)
  }

  async function removeProportion(id: string): Promise<void> {
    await proportionTable.remove(id)
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
  }

  /** 清空某香方的全部配比，并重排 seq */
  async function clearFormulaProportions(formulaId: string): Promise<number> {
    const ids = proportionsByFormula(formulaId).map((item) => item.id)
    if (ids.length === 0) return 0
    await proportionTable.bulkRemove(ids)
    await db.formulas.update(formulaId, { totalRatio: 0, updatedAt: Date.now() })
    return ids.length
  }

  /** 按 id 顺序重排 seq（拖拽排序回写） */
  async function reorder(orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return
    const now = Date.now()
    await db.transaction('rw', db.proportions, async () => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await db.proportions.update(orderedIds[index], { seq: index + 1, updatedAt: now })
      }
    })
    setSortMode('manual')
  }

  return {
    proportions,
    proportionsByFormulaMap,
    materialCountMap,
    totalByFormula,
    roleCounts,
    draft,
    draftCheck,
    selectedIds,
    sortMode,
    filter,
    loading,
    ready,
    error,
    lastError,
    hasFilter,
    proportionsByFormula,
    checkFormula,
    checkDraft,
    validateDrafts,
    patchFilter,
    resetFilter,
    setDraft,
    pushDraft,
    patchDraft,
    removeDraft,
    clearDraft,
    setSortMode,
    setSelection,
    toggleSelection,
    sortedProportions,
    createProportion,
    updateProportion,
    removeProportion,
    clearFormulaProportions,
    reorder
  }
})

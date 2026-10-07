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
import { INITIAL_MATERIAL_REV } from '@/types/material'
import { checkRatioTotal, round, sortByRoleWeight, sumRatios } from '@/utils/ratio'
import { assertMaterialAtRev } from '@/utils/master'

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
  const materialTable = useIdbTable<import('@/types/material').Material>(
    (database) => database.materials,
    { sortByUpdatedAt: false }
  )

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

  /** 香料 id → 当前主档修订号 */
  const materialRevMap = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    materialTable.rows.value.forEach((material) => {
      map[material.id] = material.rev
    })
    return map
  })

  /** 停在旧主档写法上的配比 id（正常情况下级联会即时推进，此集合用于跨页异常态提示） */
  const staleProportionIds = computed<Set<string>>(() => {
    const stale = new Set<string>()
    proportions.value.forEach((proportion) => {
      const latest = materialRevMap.value[proportion.materialId]
      if (typeof latest === 'number' && proportion.materialRev !== latest) stale.add(proportion.id)
    })
    return stale
  })

  function isStale(id: string): boolean {
    return staleProportionIds.value.has(id)
  }

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
  }): Promise<Proportion> {
    const list = proportionsByFormula(payload.formulaId)
    try {
      const material = materialTable.rows.value.find((item) => item.id === payload.materialId)
      const materialRev = typeof material?.rev === 'number' ? material.rev : INITIAL_MATERIAL_REV
      return await proportionTable.create(
        {
          formulaId: payload.formulaId,
          materialId: payload.materialId,
          ratio: round(payload.ratio, 2),
          role: payload.role,
          note: payload.note,
          materialRev,
          seq: payload.seq ?? (list.length === 0 ? 1 : Math.max(...list.map((item) => item.seq)) + 1)
        },
        'prop'
      )
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : '新增配比失败'
      throw err
    }
  }

  /**
   * 更新配比。更换香料时按 expectedMaterialRev 做乐观并发校验：
   * 表单打开后该香料主档若已被别处升版，抛 MasterConflictError，页面保留草稿并带最新修订号重试。
   */
  async function updateProportion(
    id: string,
    patch: Partial<Proportion> & { expectedMaterialRev?: number }
  ): Promise<void> {
    const { expectedMaterialRev, ...fields } = patch
    if (fields.materialId !== undefined && expectedMaterialRev !== undefined) {
      await assertMaterialAtRev(fields.materialId, expectedMaterialRev)
    }
    if (fields.materialId !== undefined) {
      const material = await db.materials.get(fields.materialId)
      fields.materialRev = material?.rev ?? INITIAL_MATERIAL_REV
    }
    await proportionTable.update(id, fields)
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
    materialRevMap,
    staleProportionIds,
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
    isStale,
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

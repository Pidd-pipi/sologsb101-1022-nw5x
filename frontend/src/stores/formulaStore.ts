import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { db, createId, readUiPrefs, writeUiPrefs } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import type { Batch } from '@/types/batch'
import type { Tasting } from '@/types/tasting'
import {
  createEmptyFormulaFilter,
  FORMULA_STATE_FLOW,
  type Formula,
  type FormulaCard,
  type FormulaFilterState,
  type FormulaState,
  type ScentType,
  type UsageScene
} from '@/types/formula'
import { round } from '@/utils/ratio'

/**
 * 香方 store：维护香方列表、当前选中香方与跨页筛选条件，
 * 并派生出配比香料数与品香均分（卡片回显）。
 */
export const useFormulaStore = defineStore('formula', () => {
  const formulaTable = useIdbTable<Formula>((database) => database.formulas)
  const batchTable = useIdbTable<Batch>((database) => database.batches)
  const tastingTable = useIdbTable<Tasting>((database) => database.tastings)

  const prefs = readUiPrefs()
  const currentFormulaId = ref<string | null>(prefs.lastFormulaId)
  const filter = ref<FormulaFilterState>(createEmptyFormulaFilter())
  const materialCountMap = ref<Record<string, number>>({})

  watch(currentFormulaId, (value) => {
    writeUiPrefs({ ...readUiPrefs(), lastFormulaId: value })
  })

  const formulas = computed<Formula[]>(() => formulaTable.rows.value)
  const batches = computed<Batch[]>(() => batchTable.rows.value)
  const tastings = computed<Tasting[]>(() => tastingTable.rows.value)
  const loading = computed(() => formulaTable.loading.value)
  const ready = computed(() => formulaTable.ready.value)
  const error = computed(() => formulaTable.error.value)

  const currentFormula = computed<Formula | null>(
    () => formulas.value.find((formula) => formula.id === currentFormulaId.value) ?? null
  )

  /** 香方 id → 配比条数（由配比 store 同步，避免重复订阅同一张表） */
  function setMaterialCountMap(map: Record<string, number>): void {
    materialCountMap.value = map
  }

  /** 香方 id → 品香评鉴列表 */
  const tastingsByFormula = computed<Record<string, Tasting[]>>(() => {
    const batchToFormula = new Map<string, string>()
    batches.value.forEach((batch) => batchToFormula.set(batch.id, batch.formulaId))
    const grouped: Record<string, Tasting[]> = {}
    tastings.value.forEach((tasting) => {
      const formulaId = batchToFormula.get(tasting.batchId)
      if (!formulaId) return
      const list = grouped[formulaId] ?? []
      list.push(tasting)
      grouped[formulaId] = list
    })
    return grouped
  })

  const batchesByFormula = computed<Record<string, Batch[]>>(() => {
    const grouped: Record<string, Batch[]> = {}
    batches.value.forEach((batch) => {
      const list = grouped[batch.formulaId] ?? []
      list.push(batch)
      grouped[batch.formulaId] = list
    })
    return grouped
  })

  /** 同香方全部品香的评分均分 */
  const scoreAggregates = computed<Record<string, { count: number; average: number; latestAt: string }>>(() => {
    const aggregate: Record<string, { count: number; average: number; latestAt: string }> = {}
    Object.entries(tastingsByFormula.value).forEach(([formulaId, list]) => {
      if (list.length === 0) return
      const sum = list.reduce((acc, item) => acc + item.smokeScore, 0)
      const latest = [...list].sort((a, b) => b.tastedAt.localeCompare(a.tastedAt))[0]
      aggregate[formulaId] = {
        count: list.length,
        average: round(sum / list.length, 1),
        latestAt: latest?.tastedAt ?? ''
      }
    })
    return aggregate
  })

  /** 香方台账卡片：配比合计、香料数、品香均分、批次数量 */
  const cards = computed<FormulaCard[]>(() =>
    formulas.value.map((formula) => {
      const aggregate = scoreAggregates.value[formula.id]
      const formulaTastings = tastingsByFormula.value[formula.id] ?? []
      const latest = [...formulaTastings].sort((a, b) => b.tastedAt.localeCompare(a.tastedAt))[0]
      return {
        formula,
        materialCount: materialCountMap.value[formula.id] ?? 0,
        latestScore: latest?.smokeScore ?? null,
        averageScore: aggregate?.average ?? null,
        batchCount: (batchesByFormula.value[formula.id] ?? []).length,
        ratioGap: round(formula.totalRatio - 100, 2)
      }
    })
  )

  const cardMap = computed<Record<string, FormulaCard>>(() => {
    const map: Record<string, FormulaCard> = {}
    cards.value.forEach((card) => {
      map[card.formula.id] = card
    })
    return map
  })

  const filteredFormulas = computed<Formula[]>(() =>
    formulas.value.filter((formula) => {
      const keyword = filter.value.keyword.trim()
      if (keyword.length > 0) {
        const haystack = `${formula.name}${formula.scentType}${formula.usage}${formula.state}`
        if (!haystack.includes(keyword)) return false
      }
      if (filter.value.scentTypes.length > 0 && !filter.value.scentTypes.includes(formula.scentType)) return false
      if (filter.value.usages.length > 0 && !filter.value.usages.includes(formula.usage)) return false
      if (filter.value.states.length > 0 && !filter.value.states.includes(formula.state)) return false
      return true
    })
  )

  const filteredCards = computed<FormulaCard[]>(() =>
    filteredFormulas.value.map((formula) => cardMap.value[formula.id]).filter((card): card is FormulaCard => Boolean(card))
  )

  const hasFilter = computed(
    () =>
      filter.value.keyword.trim().length > 0 ||
      filter.value.scentTypes.length > 0 ||
      filter.value.usages.length > 0 ||
      filter.value.states.length > 0
  )

  const stateCounts = computed<Record<FormulaState, number>>(() => {
    const counts: Record<FormulaState, number> = { 草稿: 0, 在用: 0, 停用: 0 }
    formulas.value.forEach((formula) => {
      counts[formula.state] += 1
    })
    return counts
  })

  const averageScoreAll = computed(() => {
    const list = Object.values(scoreAggregates.value)
    if (list.length === 0) return 0
    const totalCount = list.reduce((sum, item) => sum + item.count, 0)
    if (totalCount === 0) return 0
    return round(list.reduce((sum, item) => sum + item.average * item.count, 0) / totalCount, 1)
  })

  const inUseCount = computed(() => formulas.value.filter((formula) => formula.state === '在用').length)
  const balancedCount = computed(() => formulas.value.filter((formula) => Math.abs(formula.totalRatio - 100) <= 0.01).length)

  function setCurrentFormula(id: string | null): void {
    currentFormulaId.value = id
  }

  function patchFilter(patch: Partial<FormulaFilterState>): void {
    filter.value = { ...filter.value, ...patch }
  }

  function resetFilter(): void {
    filter.value = createEmptyFormulaFilter()
  }

  function formulaById(id: string): Formula | undefined {
    return formulas.value.find((formula) => formula.id === id)
  }

  function formulaName(id: string): string {
    return formulaById(id)?.name ?? '香方已删除'
  }

  async function createFormula(payload: {
    name: string
    scentType: ScentType
    usage: UsageScene
    createdAt: string
    state?: FormulaState
  }): Promise<Formula> {
    const formula = await formulaTable.create(
      {
        name: payload.name.trim(),
        scentType: payload.scentType,
        usage: payload.usage,
        createdAt: payload.createdAt,
        totalRatio: 0,
        state: payload.state ?? '草稿'
      },
      'formula'
    )
    currentFormulaId.value = formula.id
    return formula
  }

  async function updateFormula(id: string, patch: Partial<Formula>): Promise<void> {
    await formulaTable.update(id, patch)
  }

  /** 状态流转：草稿 → 在用 → 停用 → 在用 */
  async function advanceState(id: string): Promise<FormulaState | null> {
    const formula = formulaById(id)
    if (!formula) return null
    const next = FORMULA_STATE_FLOW[formula.state]
    await formulaTable.update(id, { state: next })
    return next
  }

  async function setState(id: string, state: FormulaState): Promise<void> {
    await formulaTable.update(id, { state })
  }

  /** 级联删除：香方 → 配比 → 批次 → 窖藏 → 品香 */
  async function removeFormula(id: string): Promise<{ proportions: number; batches: number; cellars: number; tastings: number }> {
    const batchIds = batches.value.filter((batch) => batch.formulaId === id).map((batch) => batch.id)
    const proportionIds = await db.proportions.where('formulaId').equals(id).primaryKeys()
    const cellarIds = batchIds.length > 0 ? await db.cellars.where('batchId').anyOf(batchIds).primaryKeys() : []
    const tastingIds = batchIds.length > 0 ? await db.tastings.where('batchId').anyOf(batchIds).primaryKeys() : []
    await db.transaction(
      'rw',
      [db.formulas, db.proportions, db.batches, db.cellars, db.tastings],
      async () => {
        await db.tastings.bulkDelete(tastingIds)
        await db.cellars.bulkDelete(cellarIds)
        await db.batches.bulkDelete(batchIds)
        await db.proportions.bulkDelete(proportionIds)
        await db.formulas.delete(id)
      }
    )
    if (currentFormulaId.value === id) currentFormulaId.value = null
    return {
      proportions: proportionIds.length,
      batches: batchIds.length,
      cellars: cellarIds.length,
      tastings: tastingIds.length
    }
  }

  /** 复制香方：连同配比一起复制为新草稿，便于派生新方 */
  async function duplicateFormula(id: string): Promise<Formula | null> {
    const source = formulaById(id)
    if (!source) return null
    const proportions = await db.proportions.where('formulaId').equals(id).toArray()
    const now = Date.now()
    const copy = await formulaTable.create(
      {
        name: `${source.name}（副本）`,
        scentType: source.scentType,
        usage: source.usage,
        createdAt: new Date().toISOString().slice(0, 10),
        totalRatio: source.totalRatio,
        state: '草稿'
      },
      'formula'
    )
    if (proportions.length > 0) {
      await db.proportions.bulkPut(
        proportions.map((proportion, index) => ({
          ...proportion,
          id: createId('prop'),
          formulaId: copy.id,
          seq: proportion.seq > 0 ? proportion.seq : index + 1,
          updatedAt: now
        }))
      )
    }
    return copy
  }

  return {
    formulas,
    batches,
    tastings,
    loading,
    ready,
    error,
    currentFormulaId,
    currentFormula,
    filter,
    cards,
    cardMap,
    filteredFormulas,
    filteredCards,
    batchesByFormula,
    tastingsByFormula,
    scoreAggregates,
    stateCounts,
    hasFilter,
    averageScoreAll,
    inUseCount,
    balancedCount,
    setCurrentFormula,
    setMaterialCountMap,
    patchFilter,
    resetFilter,
    formulaById,
    formulaName,
    createFormula,
    updateFormula,
    advanceState,
    setState,
    removeFormula,
    duplicateFormula
  }
})

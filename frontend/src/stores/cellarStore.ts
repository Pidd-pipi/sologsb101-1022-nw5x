import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db, createId, readUiPrefs, writeUiPrefs } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import {
  CELLAR_NEAR_DAYS,
  CELLAR_STATE_FLOW,
  createEmptyCellarFilter,
  type Cellar,
  type CellarContainer,
  type CellarFilterState,
  type CellarRow,
  type CellarState,
  type CellarUrgency
} from '@/types/cellar'
import type { Batch } from '@/types/batch'
import type { Formula } from '@/types/formula'
import { round } from '@/utils/ratio'
import { lockBatchSnapshot, unlockBatchSnapshot } from '@/utils/masterSync'

/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 把 yyyy-MM-dd 解析为当天 0 点的毫秒数，非法日期返回 NaN */
export function parseDate(value: string): number {
  if (!value) return Number.NaN
  const parts = value.split('-').map((item) => Number(item))
  if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) return Number.NaN
  return new Date(parts[0], parts[1] - 1, parts[2]).getTime()
}

/** 计算两个日期之间的整天数（to - from） */
export function daysBetween(from: string, to: string): number {
  const start = parseDate(from)
  const end = parseDate(to)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.round((end - start) / DAY_MS)
}

/** 今天（本地时区）的 yyyy-MM-dd */
export function todayIso(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * 窖藏 store：维护窖藏批次、环境读数与排序方式，
 * 派生临近出窖提醒（逾期 / 临近 / 正常 / 已出窖）。
 */
export const useCellarStore = defineStore('cellar', () => {
  const cellarTable = useIdbTable<Cellar>((database) => database.cellars)
  const batchTable = useIdbTable<Batch>((database) => database.batches, { sortByUpdatedAt: false })
  const formulaTable = useIdbTable<Formula>((database) => database.formulas, { sortByUpdatedAt: false })

  const prefs = readUiPrefs()
  const sortMode = ref<'remain' | 'start'>(prefs.cellarSort)
  const filter = ref<CellarFilterState>(createEmptyCellarFilter())
  const currentCellarId = ref<string | null>(null)

  const cellars = computed<Cellar[]>(() => cellarTable.rows.value)
  const batches = computed<Batch[]>(() => batchTable.rows.value)
  const formulas = computed<Formula[]>(() => formulaTable.rows.value)
  const loading = computed(() => cellarTable.loading.value)
  const ready = computed(() => cellarTable.ready.value)
  const error = computed(() => cellarTable.error.value)

  const currentCellar = computed<Cellar | null>(
    () => cellars.value.find((cellar) => cellar.id === currentCellarId.value) ?? null
  )

  const batchMap = computed<Record<string, Batch>>(() => {
    const map: Record<string, Batch> = {}
    batches.value.forEach((batch) => {
      map[batch.id] = batch
    })
    return map
  })

  const formulaNameMap = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    formulas.value.forEach((formula) => {
      map[formula.id] = formula.name
    })
    return map
  })

  /** 批次标签：香方名 · 和香日期 · 成型方式 */
  function batchLabel(batchId: string): string {
    const batch = batchMap.value[batchId]
    if (!batch) return '批次已删除'
    const name = formulaNameMap.value[batch.formulaId] ?? '香方已删除'
    return `${name} · ${batch.mixedAt} · ${batch.formingMethod}`
  }

  function urgencyOf(cellar: Cellar): CellarUrgency {
    if (cellar.state === '已出窖') return 'done'
    const remain = daysBetween(todayIso(), cellar.endDate)
    if (remain < 0) return 'overdue'
    if (remain <= CELLAR_NEAR_DAYS) return 'near'
    return 'normal'
  }

  /** 全部窖藏行：附带批次、香方与剩余天数 */
  const rows = computed<CellarRow[]>(() =>
    cellars.value.map((cellar) => {
      const batch = batchMap.value[cellar.batchId]
      return {
        cellar,
        batchLabel: batchLabel(cellar.batchId),
        formulaName: batch ? formulaNameMap.value[batch.formulaId] ?? '香方已删除' : '香方已删除',
        quantity: batch?.quantity ?? 0,
        remainDays: daysBetween(todayIso(), cellar.endDate),
        agedDays: daysBetween(cellar.startDate, todayIso()),
        urgency: urgencyOf(cellar)
      }
    })
  )

  /** 按排序方式排列：临近出窖（剩余天数升序）/ 按入窖日期 */
  const sortedRows = computed<CellarRow[]>(() => {
    const list = [...rows.value]
    if (sortMode.value === 'start') {
      return list.sort((a, b) => b.cellar.startDate.localeCompare(a.cellar.startDate))
    }
    return list.sort((a, b) => {
      const rank = (row: CellarRow): number => (row.urgency === 'done' ? 1 : 0)
      const rankDiff = rank(a) - rank(b)
      if (rankDiff !== 0) return rankDiff
      return a.remainDays - b.remainDays
    })
  })

  const filteredRows = computed<CellarRow[]>(() =>
    sortedRows.value.filter((row) => {
      const keyword = filter.value.keyword.trim()
      if (keyword.length > 0) {
        const haystack = `${row.batchLabel}${row.formulaName}${row.cellar.container}${row.cellar.state}`
        if (!haystack.includes(keyword)) return false
      }
      if (filter.value.states.length > 0 && !filter.value.states.includes(row.cellar.state)) return false
      if (filter.value.containers.length > 0 && !filter.value.containers.includes(row.cellar.container)) return false
      return true
    })
  )

  /** 临近出窖提醒：逾期 + 14 天内到期的在窖批次 */
  const alerts = computed<CellarRow[]>(() =>
    sortedRows.value.filter((row) => row.urgency === 'overdue' || row.urgency === 'near')
  )

  const agingCount = computed(() => cellars.value.filter((cellar) => cellar.state === '窖藏中').length)
  const doneCount = computed(() => cellars.value.filter((cellar) => cellar.state === '已出窖').length)

  const averageTemperature = computed(() => {
    const list = cellars.value.filter((cellar) => cellar.state === '窖藏中')
    if (list.length === 0) return 0
    return round(list.reduce((sum, cellar) => sum + cellar.temperatureC, 0) / list.length, 1)
  })

  const averageHumidity = computed(() => {
    const list = cellars.value.filter((cellar) => cellar.state === '窖藏中')
    if (list.length === 0) return 0
    return round(list.reduce((sum, cellar) => sum + cellar.humidityPct, 0) / list.length, 1)
  })

  /** 温湿度是否在建议区间内（18~26℃ / 50~70%） */
  const environmentWarning = computed(() =>
    cellars.value
      .filter((cellar) => cellar.state === '窖藏中')
      .filter((cellar) => cellar.temperatureC < 18 || cellar.temperatureC > 26 || cellar.humidityPct < 50 || cellar.humidityPct > 70)
      .map((cellar) => ({
        cellarId: cellar.id,
        label: batchLabel(cellar.batchId),
        temperatureC: cellar.temperatureC,
        humidityPct: cellar.humidityPct
      }))
  )

  const hasFilter = computed(
    () =>
      filter.value.keyword.trim().length > 0 ||
      filter.value.states.length > 0 ||
      filter.value.containers.length > 0
  )

  function setSortMode(mode: 'remain' | 'start'): void {
    sortMode.value = mode
    writeUiPrefs({ ...readUiPrefs(), cellarSort: mode })
  }

  function setCurrentCellar(id: string | null): void {
    currentCellarId.value = id
  }

  function patchFilter(patch: Partial<CellarFilterState>): void {
    filter.value = { ...filter.value, ...patch }
  }

  function resetFilter(): void {
    filter.value = createEmptyCellarFilter()
  }

  function cellarById(id: string): Cellar | undefined {
    return cellars.value.find((cellar) => cellar.id === id)
  }

  function cellarsOfBatch(batchId: string): Cellar[] {
    return cellars.value.filter((cellar) => cellar.batchId === batchId)
  }

  async function createCellar(payload: {
    batchId: string
    startDate: string
    endDate: string
    temperatureC: number
    humidityPct: number
    container: CellarContainer
    state?: CellarState
  }): Promise<Cellar> {
    // 入窖登记与快照锁定放在同一事务：入窖即锁住当时等级 / 炮制写法
    const now = Date.now()
    const record: Cellar = {
      id: createId('cellar'),
      batchId: payload.batchId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      temperatureC: round(payload.temperatureC, 1),
      humidityPct: round(payload.humidityPct, 1),
      container: payload.container,
      state: payload.state ?? '窖藏中',
      updatedAt: now
    }
    await db.transaction('rw', [db.cellars, db.batches, db.proportions, db.materials], async () => {
      await db.cellars.put(record)
      await lockBatchSnapshot(payload.batchId)
    })
    return record
  }

  async function updateCellar(id: string, patch: Partial<Cellar>): Promise<void> {
    const next: Partial<Cellar> = { ...patch }
    if (patch.temperatureC !== undefined) next.temperatureC = round(patch.temperatureC, 1)
    if (patch.humidityPct !== undefined) next.humidityPct = round(patch.humidityPct, 1)
    const previous = patch.batchId !== undefined ? cellarById(id) : undefined
    if (previous && previous.batchId !== patch.batchId) {
      // 改挂批次：新批次入窖锁定，旧批次解锁回到随主档重算
      await db.transaction(
        'rw',
        [db.cellars, db.batches, db.proportions, db.materials],
        async () => {
          await cellarTable.update(id, next)
          await lockBatchSnapshot(patch.batchId as string)
          await unlockBatchSnapshot(previous.batchId)
        }
      )
      return
    }
    await cellarTable.update(id, next)
  }

  /** 状态流转：窖藏中 → 已出窖（可回退） */
  async function advanceState(id: string): Promise<CellarState | null> {
    const cellar = cellarById(id)
    if (!cellar) return null
    const next = CELLAR_STATE_FLOW[cellar.state]
    const patch: Partial<Cellar> = { state: next }
    if (next === '已出窖' && cellar.endDate > todayIso()) {
      patch.endDate = todayIso()
    }
    await cellarTable.update(id, patch)
    return next
  }

  async function setState(id: string, state: CellarState): Promise<void> {
    await cellarTable.update(id, { state })
  }

  /** 一键出窖：把全部逾期的在窖批次置为已出窖 */
  async function releaseOverdue(): Promise<number> {
    const targets = rows.value.filter((row) => row.cellar.state === '窖藏中' && row.remainDays < 0)
    if (targets.length === 0) return 0
    const now = Date.now()
    await db.transaction('rw', db.cellars, async () => {
      for (const row of targets) {
        await db.cellars.update(row.cellar.id, { state: '已出窖', updatedAt: now })
      }
    })
    return targets.length
  }

  async function removeCellar(id: string): Promise<void> {
    const cellar = cellarById(id)
    await cellarTable.remove(id)
    if (currentCellarId.value === id) currentCellarId.value = null
    // 该批次已无窖藏记录：解锁并按最新主档重算快照
    if (cellar) await unlockBatchSnapshot(cellar.batchId)
  }

  async function removeCellarsOfBatch(batchId: string): Promise<number> {
    const ids = cellarsOfBatch(batchId).map((cellar) => cellar.id)
    if (ids.length === 0) return 0
    await cellarTable.bulkRemove(ids)
    await unlockBatchSnapshot(batchId)
    return ids.length
  }

  return {
    cellars,
    batches,
    formulas,
    loading,
    ready,
    error,
    sortMode,
    filter,
    currentCellarId,
    currentCellar,
    rows,
    sortedRows,
    filteredRows,
    alerts,
    agingCount,
    doneCount,
    averageTemperature,
    averageHumidity,
    environmentWarning,
    hasFilter,
    batchMap,
    batchLabel,
    setSortMode,
    setCurrentCellar,
    patchFilter,
    resetFilter,
    cellarById,
    cellarsOfBatch,
    createCellar,
    updateCellar,
    advanceState,
    setState,
    releaseOverdue,
    removeCellar,
    removeCellarsOfBatch
  }
})

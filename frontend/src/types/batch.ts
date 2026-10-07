/** 和香批次：一次实际的配料与成型作业 */
export type FormingMethod = '挤条' | '手搓' | '压模' | '炼蜜成丸'

/** 批次生成时固化的配比快照条目，用于追溯改方前后的差异 */
export interface BatchSnapshotItem {
  materialId: string
  materialName: string
  ratio: number
  role: string
  /**
   * 快照落字时的等级与炮制方式。
   * 未入窖批次随主档联动重算保持最新；已入窖批次锁住入窖当时写法，不再跟随主档。
   */
  grade: string
  processMethod: string
  /** 该条目停在的主档修订号 */
  materialRev: number
}

export interface Batch {
  id: string
  /** 所属香方 */
  formulaId: string
  /** 和香日期（ISO 日期串 yyyy-MM-dd） */
  mixedAt: string
  /** 成型方式：挤条/手搓/压模/炼蜜成丸 */
  formingMethod: FormingMethod
  /** 数量（支 / 丸 / 饼） */
  quantity: number
  /** 制香人 */
  operator: string
  /** 和香当刻固化的配比快照 */
  snapshot: BatchSnapshotItem[]
  /** 快照固化时间戳 */
  snapshotAt: number
  updatedAt: number
}

export const FORMING_METHODS: FormingMethod[] = ['挤条', '手搓', '压模', '炼蜜成丸']

/** 批次列表行：批次 + 香方 + 窖藏状态 */
export interface BatchRow {
  batch: Batch
  formulaName: string
  /** 快照条目数 */
  snapshotCount: number
  /** 当前配比合计，用于对照快照差异 */
  currentRatioTotal: number
  /** 快照配比合计 */
  snapshotRatioTotal: number
  /** 是否已进入窖藏（入窖即锁住快照写法） */
  cellared: boolean
  cellarState: string
  /** 快照是否锁住：已入窖为 true，主档再改也不重算 */
  snapshotLocked: boolean
  /** 未入窖批次的快照中，有多少味已落后于主档修订号 */
  staleSnapshotCount: number
}

/** 批次筛选条件 */
export interface BatchFilterState {
  keyword: string
  formulas: string[]
  formingMethods: FormingMethod[]
}

export function createEmptyBatchFilter(): BatchFilterState {
  return { keyword: '', formulas: [], formingMethods: [] }
}

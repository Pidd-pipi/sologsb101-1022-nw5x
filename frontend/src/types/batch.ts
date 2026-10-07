/** 和香批次：一次实际的配料与成型作业 */
export type FormingMethod = '挤条' | '手搓' | '压模' | '炼蜜成丸'

/** 批次生成时固化的配比快照条目，用于追溯改方前后的差异 */
export interface BatchSnapshotItem {
  materialId: string
  materialName: string
  ratio: number
  role: string
  /**
   * 固化当时的等级 / 炮制写法：已入窖批次锁定当时写法，
   * 未入窖批次会随主档修订自动失效重算。
   */
  grade: string
  processMethod: string
  /** 该条快照依据的香料主档修订号 */
  materialRevision: number
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
  /** 是否已入窖锁定：锁定后主档再改也不重算快照，保留当时写法 */
  locked: boolean
  /** 入窖锁定时间戳（0 表示尚未锁定） */
  lockedAt: number
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
  /** 是否已进入窖藏 */
  cellared: boolean
  cellarState: string
  /**
   * 快照里停在旧主档写法的味数（等级 / 炮制被改过）。
   * 未入窖的批次会自动重算；已入窖锁定后该值保留，提示「当时写法」。
   */
  staleMaterialCount: number
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

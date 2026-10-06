/** 香方：一款香的配方主档 */
export type ScentType = '线香' | '盘香' | '香丸' | '香饼'
export type UsageScene = '静室' | '礼佛' | '佩香' | '熏衣'
export type FormulaState = '草稿' | '在用' | '停用'

export interface Formula {
  id: string
  /** 香方名 */
  name: string
  /** 香型：线香/盘香/香丸/香饼 */
  scentType: ScentType
  /** 用途：静室/礼佛/佩香/熏衣 */
  usage: UsageScene
  /** 创方日期（ISO 日期串 yyyy-MM-dd） */
  createdAt: string
  /** 总配比%，配比页实时回写 */
  totalRatio: number
  /** 配方状态：草稿/在用/停用 */
  state: FormulaState
  updatedAt: number
}

export const SCENT_TYPES: ScentType[] = ['线香', '盘香', '香丸', '香饼']
export const USAGE_SCENES: UsageScene[] = ['静室', '礼佛', '佩香', '熏衣']
export const FORMULA_STATES: FormulaState[] = ['草稿', '在用', '停用']

/** 香方状态流转：草稿 → 在用 → 停用 → 在用 */
export const FORMULA_STATE_FLOW: Record<FormulaState, FormulaState> = {
  草稿: '在用',
  在用: '停用',
  停用: '在用'
}

/** 香方台账卡片上的派生统计 */
export interface FormulaCard {
  formula: Formula
  materialCount: number
  /** 最近一次品香评分（1-10），无评鉴时为 null */
  latestScore: number | null
  /** 同香方全部品香均分，无评鉴时为 null */
  averageScore: number | null
  batchCount: number
  /** 配比合计与 100 的偏差 */
  ratioGap: number
}

/** 香方台账组合筛选条件 */
export interface FormulaFilterState {
  keyword: string
  scentTypes: ScentType[]
  usages: UsageScene[]
  states: FormulaState[]
}

export function createEmptyFormulaFilter(): FormulaFilterState {
  return { keyword: '', scentTypes: [], usages: [], states: [] }
}

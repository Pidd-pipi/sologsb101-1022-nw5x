/** 品香评鉴：对某一和香批次的闻香记录 */
export interface Tasting {
  id: string
  /** 关联和香批次 */
  batchId: string
  /** 品鉴日期（ISO 日期串 yyyy-MM-dd） */
  tastedAt: string
  /** 香韵描述 */
  aroma: string
  /** 留香时长（分钟） */
  lastingMin: number
  /** 烟气评分 1-10 */
  smokeScore: number
  /** 评语 */
  comment: string
  updatedAt: number
}

/** 烟气评分的分值区间档位，GradeTag 消费 */
export type ScoreBand = 'excellent' | 'good' | 'fair' | 'poor'

/** 评分区间 → 档位：9-10 上品 / 7-8 佳 / 5-6 中平 / 1-4 待调 */
export function scoreBand(score: number): ScoreBand {
  if (score >= 9) return 'excellent'
  if (score >= 7) return 'good'
  if (score >= 5) return 'fair'
  return 'poor'
}

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  excellent: '上品',
  good: '佳',
  fair: '中平',
  poor: '待调'
}

export const SCORE_BAND_COLOR: Record<ScoreBand, string> = {
  excellent: '#8a5a2b',
  good: '#1e8449',
  fair: '#b07d3a',
  poor: '#c0392b'
}

export const SCORE_BAND_BG: Record<ScoreBand, string> = {
  excellent: '#f6ece1',
  good: '#eaf6ee',
  fair: '#faf3e6',
  poor: '#fdecea'
}

export const SCORE_BAND_ICON: Record<ScoreBand, string> = {
  excellent: 'Trophy',
  good: 'CircleCheckFilled',
  fair: 'InfoFilled',
  poor: 'WarningFilled'
}

/** 品香列表行：品香 + 批次 + 香方 */
export interface TastingRow {
  tasting: Tasting
  batchLabel: string
  formulaId: string | null
  formulaName: string
  formingMethod: string
}

/** 某香方的品香均分聚合结果 */
export interface ScoreAggregate {
  formulaId: string
  count: number
  average: number
  latestAt: string
}

/** 品香筛选条件 */
export interface TastingFilterState {
  keyword: string
  formulas: string[]
  bands: ScoreBand[]
}

export function createEmptyTastingFilter(): TastingFilterState {
  return { keyword: '', formulas: [], bands: [] }
}

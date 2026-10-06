/** 窖藏：和香成型后的陈化环境记录 */
export type CellarState = '窖藏中' | '已出窖'
export type CellarContainer = '陶罐' | '锡罐' | '竹筒'

export interface Cellar {
  id: string
  /** 关联和香批次 */
  batchId: string
  /** 入窖日期（ISO 日期串 yyyy-MM-dd） */
  startDate: string
  /** 计划出窖日期（ISO 日期串 yyyy-MM-dd） */
  endDate: string
  /** 窖藏温度 ℃ */
  temperatureC: number
  /** 窖藏湿度 % */
  humidityPct: number
  /** 容器：陶罐/锡罐/竹筒 */
  container: CellarContainer
  /** 状态：窖藏中/已出窖 */
  state: CellarState
  updatedAt: number
}

export const CELLAR_STATES: CellarState[] = ['窖藏中', '已出窖']
export const CELLAR_CONTAINERS: CellarContainer[] = ['陶罐', '锡罐', '竹筒']

/** 窖藏状态流转：窖藏中 → 已出窖 */
export const CELLAR_STATE_FLOW: Record<CellarState, CellarState> = {
  窖藏中: '已出窖',
  已出窖: '窖藏中'
}

/** 临近出窖提醒阈值：剩余天数小于等于该值即提醒 */
export const CELLAR_NEAR_DAYS = 14

export type CellarUrgency = 'overdue' | 'near' | 'normal' | 'done'

/** 窖藏列表行：窖藏 + 批次 + 香方 + 剩余天数 */
export interface CellarRow {
  cellar: Cellar
  batchLabel: string
  formulaName: string
  quantity: number
  /** 距计划出窖的天数（正数=剩余，负数=已逾期） */
  remainDays: number
  /** 已窖藏天数 */
  agedDays: number
  urgency: CellarUrgency
}

/** 窖藏环境读数筛选条件 */
export interface CellarFilterState {
  keyword: string
  states: CellarState[]
  containers: CellarContainer[]
}

export function createEmptyCellarFilter(): CellarFilterState {
  return { keyword: '', states: [], containers: [] }
}

/** 配比：香方中某味香料的用量与君臣佐使定位 */
export type ProportionRole = '君' | '臣' | '佐' | '使'

export interface Proportion {
  id: string
  /** 所属香方 */
  formulaId: string
  /** 引用香料 */
  materialId: string
  /** 占比 %，同一香方合计应等于 100 */
  ratio: number
  /** 君臣佐使定位 */
  role: ProportionRole
  /** 备注：炮制要点、替代香材等 */
  note: string
  /** 君臣佐使编排顺序（拖拽排序回写） */
  seq: number
  updatedAt: number
}

export const PROPORTION_ROLES: ProportionRole[] = ['君', '臣', '佐', '使']

/** 君臣佐使权重：君最重，用于拖拽排序与占比建议 */
export const ROLE_WEIGHT: Record<ProportionRole, number> = {
  君: 40,
  臣: 30,
  佐: 20,
  使: 10
}

/** 角色配色，标签与图表共用 */
export const ROLE_COLOR: Record<ProportionRole, string> = {
  君: '#8a5a2b',
  臣: '#b07d3a',
  佐: '#6b8e6b',
  使: '#5b7fa6'
}

/** 角色释义，表单与提示文案复用 */
export const ROLE_HINT: Record<ProportionRole, string> = {
  君: '主香，定一款香的基调',
  臣: '辅香，助君香之力',
  佐: '佐香，制君香之偏',
  使: '使香，引诸香融合',
}

/** 香方配比合计校验结果 */
export interface RatioCheck {
  total: number
  /** 与 100 的偏差（合计 - 100） */
  gap: number
  /** 是否等于 100（保留两位小数后比较） */
  balanced: boolean
  /** 提示文案与严重程度 */
  level: 'ok' | 'warn' | 'error'
  message: string
}

/** 配比页草稿行：配比 + 香料快照 */
export interface ProportionDraft {
  id: string
  formulaId: string
  materialId: string
  materialName: string
  origin: string
  grade: string
  processMethod: string
  ratio: number
  role: ProportionRole
  note: string
  seq: number
}

/** 配比页筛选条件 */
export interface ProportionFilterState {
  keyword: string
  roles: ProportionRole[]
  grades: string[]
}

export function createEmptyProportionFilter(): ProportionFilterState {
  return { keyword: '', roles: [], grades: [] }
}

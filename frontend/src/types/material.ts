/** 香料：香方配伍所用的单味香材 */
export type MaterialGrade = '特级' | '一级' | '二级'
export type ProcessMethod = '生用' | '酒蒸' | '蜜炙' | '炒黄' | '醋浸'

export interface Material {
  id: string
  /** 香料名 */
  name: string
  /** 产地 */
  origin: string
  /** 等级：特级/一级/二级 */
  grade: MaterialGrade
  /** 炮制方式：生用/酒蒸/蜜炙/炒黄/醋浸 */
  processMethod: ProcessMethod
  /** 香气特征 */
  aromaNote: string
  /** 入库日期（ISO 日期串 yyyy-MM-dd） */
  createdAt: string
  /**
   * 主档修订号：等级 / 炮制方式每改一次 +1。
   * 配比与批次快照片靠它判断自己停在哪一版主档上（v3 起）。
   */
  revision: number
  updatedAt: number
}

/** 历史数据（v2 及以前）没有修订号，升级时按当前值回填为起始修订号 */
export const INITIAL_MATERIAL_REVISION = 1

export const MATERIAL_GRADES: MaterialGrade[] = ['特级', '一级', '二级']
export const PROCESS_METHODS: ProcessMethod[] = ['生用', '酒蒸', '蜜炙', '炒黄', '醋浸']

/** 等级排序权重：特级最前，用于表格排序与等级配色 */
export const GRADE_WEIGHT: Record<MaterialGrade, number> = {
  特级: 30,
  一级: 20,
  二级: 10
}

/** 等级配色（底色 / 文字色 / 图标），GradeTag 组件消费 */
export const GRADE_COLOR: Record<MaterialGrade, string> = {
  特级: '#8a5a2b',
  一级: '#b07d3a',
  二级: '#8c8479'
}

export const GRADE_BG: Record<MaterialGrade, string> = {
  特级: '#f6ece1',
  一级: '#faf3e6',
  二级: '#f2f1ef'
}

export const GRADE_ICON: Record<MaterialGrade, string> = {
  特级: 'Trophy',
  一级: 'Medal',
  二级: 'Collection'
}

/** 香料库检索条件 */
export interface MaterialFilterState {
  keyword: string
  grades: MaterialGrade[]
  origins: string[]
  processMethods: ProcessMethod[]
}

export function createEmptyMaterialFilter(): MaterialFilterState {
  return { keyword: '', grades: [], origins: [], processMethods: [] }
}

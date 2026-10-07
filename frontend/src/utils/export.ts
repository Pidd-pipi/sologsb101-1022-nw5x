import {
  db,
  DB_VERSION,
  createId,
  stampBackupTime,
  exportSnapshot,
  importSnapshot,
  type IncenseSnapshot
} from '@/utils/db'
import {
  FORMULA_STATES,
  SCENT_TYPES,
  USAGE_SCENES,
  type Formula,
  type FormulaState,
  type ScentType,
  type UsageScene
} from '@/types/formula'
import {
  INITIAL_MATERIAL_REV,
  MATERIAL_GRADES,
  PROCESS_METHODS,
  type Material,
  type MaterialGrade,
  type ProcessMethod
} from '@/types/material'
import { PROPORTION_ROLES, type Proportion, type ProportionRole } from '@/types/proportion'
import { FORMING_METHODS, type Batch, type FormingMethod } from '@/types/batch'
import { CELLAR_CONTAINERS, CELLAR_STATES, type Cellar, type CellarState, type CellarContainer } from '@/types/cellar'
import type { Tasting } from '@/types/tasting'
import { normalizeMaterialRev, normalizeSnapshotItem } from '@/utils/master'

/** 单方香方导出文件结构：一个香方 + 其配比 + 派生批次、窖藏、品香 */
export interface FormulaExportPayload {
  app: 'gbincense'
  kind: 'formula'
  dbVersion: number
  exportedAt: string
  formula: Formula
  proportions: Proportion[]
  batches: Batch[]
  cellars: Cellar[]
  tastings: Tasting[]
  /** 导出时一并携带被引用的香料主档，便于跨设备还原 */
  materials: Material[]
}

export interface ValidateResult<T> {
  ok: boolean
  errors: string[]
  payload: T | null
}

const MATERIAL_GRADE_SET = new Set<string>(MATERIAL_GRADES)
const PROCESS_METHOD_SET = new Set<string>(PROCESS_METHODS)
const SCENT_TYPE_SET = new Set<string>(SCENT_TYPES)
const USAGE_SET = new Set<string>(USAGE_SCENES)
const FORMULA_STATE_SET = new Set<string>(FORMULA_STATES)
const ROLE_SET = new Set<string>(PROPORTION_ROLES)
const FORMING_SET = new Set<string>(FORMING_METHODS)
const CELLAR_STATE_SET = new Set<string>(CELLAR_STATES)
const CELLAR_CONTAINER_SET = new Set<string>(CELLAR_CONTAINERS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function pickEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : fallback
}

/** 把香方及其下游数据整理成导出结构 */
export async function buildFormulaPayload(formulaId: string): Promise<FormulaExportPayload | null> {
  const formula = await db.formulas.get(formulaId)
  if (!formula) return null
  const [proportions, batches] = await Promise.all([
    db.proportions.where('formulaId').equals(formulaId).toArray(),
    db.batches.where('formulaId').equals(formulaId).toArray()
  ])
  const batchIds = batches.map((batch) => batch.id)
  const [cellars, tastings] = await Promise.all([
    batchIds.length > 0 ? db.cellars.where('batchId').anyOf(batchIds).toArray() : Promise.resolve([]),
    batchIds.length > 0 ? db.tastings.where('batchId').anyOf(batchIds).toArray() : Promise.resolve([])
  ])
  const materialIds = Array.from(new Set(proportions.map((item) => item.materialId)))
  const materials =
    materialIds.length > 0 ? await db.materials.where('id').anyOf(materialIds).toArray() : []
  return {
    app: 'gbincense',
    kind: 'formula',
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    formula,
    proportions: proportions.sort((a, b) => a.seq - b.seq),
    batches,
    cellars,
    tastings,
    materials
  }
}

/** 导出单个香方为 JSON 文件并触发下载 */
export async function exportFormulaJson(formulaId: string): Promise<{ fileName: string; counts: Record<string, number> }> {
  const payload = await buildFormulaPayload(formulaId)
  if (!payload) throw new Error('香方不存在，无法导出')
  const fileName = `gbincense-formula-${payload.formula.name}-${payload.exportedAt.slice(0, 10)}.json`
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  stampBackupTime(payload.exportedAt)
  return {
    fileName,
    counts: {
      proportions: payload.proportions.length,
      batches: payload.batches.length,
      cellars: payload.cellars.length,
      tastings: payload.tastings.length,
      materials: payload.materials.length
    }
  }
}

/** 导出全量本地快照为 JSON 文件 */
export async function exportSnapshotJson(): Promise<{ fileName: string; counts: Record<string, number> }> {
  const snapshot = await exportSnapshot()
  const fileName = `gbincense-snapshot-v${snapshot.dbVersion}-${snapshot.exportedAt
    .slice(0, 19)
    .replace(/[:T]/g, '')}.json`
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  stampBackupTime(snapshot.exportedAt)
  return {
    fileName,
    counts: {
      formulas: snapshot.formulas.length,
      materials: snapshot.materials.length,
      proportions: snapshot.proportions.length,
      batches: snapshot.batches.length,
      cellars: snapshot.cellars.length,
      tastings: snapshot.tastings.length
    }
  }
}

function parseFormula(input: unknown, errors: string[]): Formula | null {
  if (!isRecord(input)) {
    errors.push('formula 字段不是合法的对象')
    return null
  }
  const name = asString(input.name).trim()
  if (name.length === 0) errors.push('香方缺少 name 字段')
  const scentType = pickEnum<ScentType>(input.scentType, SCENT_TYPE_SET, '线香')
  if (typeof input.scentType !== 'string' || !SCENT_TYPE_SET.has(input.scentType)) {
    errors.push(`scentType 取值非法：${String(input.scentType)}`)
  }
  const usage = pickEnum<UsageScene>(input.usage, USAGE_SET, '静室')
  if (typeof input.usage !== 'string' || !USAGE_SET.has(input.usage)) {
    errors.push(`usage 取值非法：${String(input.usage)}`)
  }
  const state = pickEnum<FormulaState>(input.state, FORMULA_STATE_SET, '草稿')
  const createdAt = asString(input.createdAt, new Date().toISOString().slice(0, 10))
  const totalRatio = asNumber(input.totalRatio, 0)
  if (errors.length > 0) return null
  return {
    id: asString(input.id, createId('formula')),
    name,
    scentType,
    usage,
    createdAt,
    totalRatio,
    state,
    updatedAt: asNumber(input.updatedAt, Date.now())
  }
}

function parseMaterial(raw: unknown, errors: string[], index: number): Material | null {
  if (!isRecord(raw)) {
    errors.push(`materials[${index}] 不是合法对象`)
    return null
  }
  const name = asString(raw.name).trim()
  if (name.length === 0) {
    errors.push(`materials[${index}] 缺少 name`)
    return null
  }
  if (typeof raw.grade === 'string' && !MATERIAL_GRADE_SET.has(raw.grade)) {
    errors.push(`materials[${index}] grade 取值非法：${raw.grade}`)
    return null
  }
  if (typeof raw.processMethod === 'string' && !PROCESS_METHOD_SET.has(raw.processMethod)) {
    errors.push(`materials[${index}] processMethod 取值非法：${raw.processMethod}`)
    return null
  }
  return {
    id: asString(raw.id, createId('material')),
    name,
    origin: asString(raw.origin, '未记录'),
    grade: pickEnum<MaterialGrade>(raw.grade, MATERIAL_GRADE_SET, '二级'),
    processMethod: pickEnum<ProcessMethod>(raw.processMethod, PROCESS_METHOD_SET, '生用'),
    aromaNote: asString(raw.aromaNote),
    createdAt: asString(raw.createdAt, new Date().toISOString().slice(0, 10)),
    rev: normalizeMaterialRev({ rev: asNumber(raw.rev, NaN) } as Partial<Material>),
    updatedAt: asNumber(raw.updatedAt, Date.now())
  }
}

/**
 * 校验并规范化导入的香方 JSON。
 * 校验失败时返回 errors，调用方据此给出 ElMessage 提示。
 */
export function validateFormulaJson(input: unknown): ValidateResult<FormulaExportPayload> {
  const errors: string[] = []
  if (!isRecord(input)) {
    return { ok: false, errors: ['文件内容不是合法的 JSON 对象'], payload: null }
  }
  if (input.app !== 'gbincense') errors.push('app 字段应为 gbincense，文件来源不明')
  if (input.kind !== undefined && input.kind !== 'formula') errors.push('kind 字段应为 formula')
  const formula = parseFormula(input.formula, errors)
  if (!Array.isArray(input.proportions)) {
    errors.push('proportions 字段缺失或不是数组')
  }
  if (!Array.isArray(input.materials)) {
    errors.push('materials 字段缺失或不是数组')
  }
  if (errors.length > 0 || !formula) {
    return { ok: false, errors: errors.length > 0 ? errors : ['香方解析失败'], payload: null }
  }

  const materialIds = new Set<string>()
  const materials: Material[] = []
  ;(input.materials as unknown[]).forEach((raw, index) => {
    const material = parseMaterial(raw, errors, index)
    if (material) {
      materials.push(material)
      materialIds.add(material.id)
    }
  })

  const proportions: Proportion[] = []
  ;(input.proportions as unknown[]).forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`proportions[${index}] 不是合法对象`)
      return
    }
    const materialId = asString(raw.materialId)
    if (materialId.length === 0) {
      errors.push(`proportions[${index}] 缺少 materialId`)
      return
    }
    if (typeof raw.role !== 'string' || !ROLE_SET.has(raw.role)) {
      errors.push(`proportions[${index}] role 取值非法：${String(raw.role)}`)
      return
    }
    const ratio = asNumber(raw.ratio, 0)
    if (ratio < 0 || ratio > 100) {
      errors.push(`proportions[${index}] ratio 应在 0 ~ 100 之间`)
      return
    }
    proportions.push({
      id: asString(raw.id, createId('prop')),
      formulaId: formula.id,
      materialId,
      ratio,
      role: raw.role as ProportionRole,
      note: asString(raw.note),
      materialRev: asNumber(raw.materialRev, INITIAL_MATERIAL_REV),
      seq: asNumber(raw.seq, index + 1),
      updatedAt: asNumber(raw.updatedAt, Date.now())
    })
  })

  const batches: Batch[] = []
  const rawBatches = Array.isArray(input.batches) ? (input.batches as unknown[]) : []
  rawBatches.forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`batches[${index}] 不是合法对象`)
      return
    }
    if (typeof raw.formingMethod === 'string' && !FORMING_SET.has(raw.formingMethod)) {
      errors.push(`batches[${index}] formingMethod 取值非法：${raw.formingMethod}`)
      return
    }
    const rawSnapshot = Array.isArray(raw.snapshot) ? (raw.snapshot as unknown[]).filter(isRecord) : []
    batches.push({
      id: asString(raw.id, createId('batch')),
      formulaId: formula.id,
      mixedAt: asString(raw.mixedAt, new Date().toISOString().slice(0, 10)),
      formingMethod: pickEnum<FormingMethod>(raw.formingMethod, FORMING_SET, '挤条'),
      quantity: asNumber(raw.quantity, 0),
      operator: asString(raw.operator),
      snapshot: rawSnapshot.map((item) => {
        const materialId = asString((item as Record<string, unknown>).materialId)
        // 导入文件里带主档时按主档当前写法规范化旧版（v2）快照；否则保留文件内写法
        const material = materials.find((entry) => entry.id === materialId)
        return normalizeSnapshotItem(item as Record<string, unknown>, material)
      }),
      snapshotAt: asNumber(raw.snapshotAt, 0),
      updatedAt: asNumber(raw.updatedAt, Date.now())
    })
  })

  const batchIds = new Set(batches.map((batch) => batch.id))
  const cellars: Cellar[] = []
  const rawCellars = Array.isArray(input.cellars) ? (input.cellars as unknown[]) : []
  rawCellars.forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`cellars[${index}] 不是合法对象`)
      return
    }
    if (typeof raw.state === 'string' && !CELLAR_STATE_SET.has(raw.state)) {
      errors.push(`cellars[${index}] state 取值非法：${raw.state}`)
      return
    }
    const batchId = asString(raw.batchId)
    if (batchId.length === 0 || !batchIds.has(batchId)) {
      errors.push(`cellars[${index}] batchId 无法对应到本次导入的批次`)
      return
    }
    cellars.push({
      id: asString(raw.id, createId('cellar')),
      batchId,
      startDate: asString(raw.startDate, new Date().toISOString().slice(0, 10)),
      endDate: asString(raw.endDate, new Date().toISOString().slice(0, 10)),
      temperatureC: asNumber(raw.temperatureC, 22),
      humidityPct: asNumber(raw.humidityPct, 60),
      container: pickEnum<CellarContainer>(raw.container, CELLAR_CONTAINER_SET, '陶罐'),
      state: pickEnum<CellarState>(raw.state, CELLAR_STATE_SET, '窖藏中'),
      updatedAt: asNumber(raw.updatedAt, Date.now())
    })
  })

  const tastings: Tasting[] = []
  const rawTastings = Array.isArray(input.tastings) ? (input.tastings as unknown[]) : []
  rawTastings.forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`tastings[${index}] 不是合法对象`)
      return
    }
    const batchId = asString(raw.batchId)
    if (batchId.length === 0 || !batchIds.has(batchId)) {
      errors.push(`tastings[${index}] batchId 无法对应到本次导入的批次`)
      return
    }
    const smokeScore = asNumber(raw.smokeScore, 0)
    if (smokeScore < 1 || smokeScore > 10) {
      errors.push(`tastings[${index}] smokeScore 应在 1 ~ 10 之间`)
      return
    }
    tastings.push({
      id: asString(raw.id, createId('tasting')),
      batchId,
      tastedAt: asString(raw.tastedAt, new Date().toISOString().slice(0, 10)),
      aroma: asString(raw.aroma),
      lastingMin: asNumber(raw.lastingMin, 0),
      smokeScore,
      comment: asString(raw.comment),
      updatedAt: asNumber(raw.updatedAt, Date.now())
    })
  })

  if (errors.length > 0) return { ok: false, errors, payload: null }

  return {
    ok: true,
    errors: [],
    payload: {
      app: 'gbincense',
      kind: 'formula',
      dbVersion: asNumber(input.dbVersion, DB_VERSION),
      exportedAt: asString(input.exportedAt, new Date().toISOString()),
      formula,
      proportions,
      batches,
      cellars,
      tastings,
      materials
    }
  }
}

/** 校验全量快照 JSON */
export function validateSnapshotJson(input: unknown): ValidateResult<IncenseSnapshot> {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ['文件内容不是合法的 JSON 对象'], payload: null }
  if (input.app !== 'gbincense') errors.push('app 字段应为 gbincense，文件来源不明')
  const keys = ['formulas', 'materials', 'proportions', 'batches', 'cellars', 'tastings'] as const
  keys.forEach((key) => {
    if (!Array.isArray(input[key])) errors.push(`${key} 字段缺失或不是数组`)
  })
  if (errors.length > 0) return { ok: false, errors, payload: null }
  const raw = input as unknown as IncenseSnapshot
  // 旧版本（v2 及以前）导出文件没有修订号：按当前值回填，保证入库后结构与 v3 一致
  const materialById = new Map<string, Material>()
  const materials = raw.materials.map((material) => {
    const normalized: Material = { ...material, rev: normalizeMaterialRev(material) }
    materialById.set(normalized.id, normalized)
    return normalized
  })
  const snapshot: IncenseSnapshot = {
    ...raw,
    materials,
    proportions: raw.proportions.map((proportion) => ({
      ...proportion,
      materialRev:
        typeof proportion.materialRev === 'number'
          ? proportion.materialRev
          : materialById.get(proportion.materialId)?.rev ?? INITIAL_MATERIAL_REV
    })),
    batches: raw.batches.map((batch) => ({
      ...batch,
      snapshot: (batch.snapshot ?? []).map((item) => normalizeSnapshotItem(item, materialById.get(item.materialId)))
    }))
  }
  return { ok: true, errors: [], payload: snapshot }
}

/**
 * 导入单个香方：remap 为新的 id 后整体落库，避免覆盖同名香方。
 * 返回新建香方 id 与写入条数。
 */
export async function importFormulaPayload(
  payload: FormulaExportPayload
): Promise<{ formulaId: string; counts: Record<string, number> }> {
  const formulaId = createId('formula')
  const materialIdMap = new Map<string, string>()
  const batchIdMap = new Map<string, string>()

  const now = Date.now()
  const formula: Formula = { ...payload.formula, id: formulaId, updatedAt: now }
  const materials: Material[] = payload.materials.map((material) => {
    const id = createId('material')
    materialIdMap.set(material.id, id)
    return { ...material, id, updatedAt: now }
  })
  const proportions: Proportion[] = payload.proportions.map((proportion, index) => ({
    ...proportion,
    id: createId('prop'),
    formulaId,
    materialId: materialIdMap.get(proportion.materialId) ?? proportion.materialId,
    seq: proportion.seq > 0 ? proportion.seq : index + 1,
    updatedAt: now
  }))
  const batches: Batch[] = payload.batches.map((batch) => {
    const id = createId('batch')
    batchIdMap.set(batch.id, id)
    return {
      ...batch,
      id,
      formulaId,
      snapshot: batch.snapshot.map((item) => ({
        ...item,
        materialId: materialIdMap.get(item.materialId) ?? item.materialId
      })),
      updatedAt: now
    }
  })
  const cellars: Cellar[] = payload.cellars
    .filter((cellar) => batchIdMap.has(cellar.batchId))
    .map((cellar) => ({
      ...cellar,
      id: createId('cellar'),
      batchId: batchIdMap.get(cellar.batchId) as string,
      updatedAt: now
    }))
  const tastings: Tasting[] = payload.tastings
    .filter((tasting) => batchIdMap.has(tasting.batchId))
    .map((tasting) => ({
      ...tasting,
      id: createId('tasting'),
      batchId: batchIdMap.get(tasting.batchId) as string,
      updatedAt: now
    }))

  await db.transaction(
    'rw',
    [db.formulas, db.materials, db.proportions, db.batches, db.cellars, db.tastings],
    async () => {
      await db.formulas.put(formula)
      if (materials.length > 0) await db.materials.bulkPut(materials)
      if (proportions.length > 0) await db.proportions.bulkPut(proportions)
      if (batches.length > 0) await db.batches.bulkPut(batches)
      if (cellars.length > 0) await db.cellars.bulkPut(cellars)
      if (tastings.length > 0) await db.tastings.bulkPut(tastings)
    }
  )

  return {
    formulaId,
    counts: {
      materials: materials.length,
      proportions: proportions.length,
      batches: batches.length,
      cellars: cellars.length,
      tastings: tastings.length
    }
  }
}

/** 覆盖式导入全量快照 */
export async function importSnapshotPayload(
  snapshot: IncenseSnapshot,
  overwrite: boolean
): Promise<Record<string, number>> {
  await importSnapshot(snapshot, overwrite)
  return {
    formulas: snapshot.formulas.length,
    materials: snapshot.materials.length,
    proportions: snapshot.proportions.length,
    batches: snapshot.batches.length,
    cellars: snapshot.cellars.length,
    tastings: snapshot.tastings.length
  }
}

/** 读取用户选择的本地文件文本 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

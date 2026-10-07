import Dexie, { type Table } from 'dexie'
import type { Formula } from '@/types/formula'
import type { Material } from '@/types/material'
import type { Proportion } from '@/types/proportion'
import type { Batch } from '@/types/batch'
import type { Cellar } from '@/types/cellar'
import type { Tasting } from '@/types/tasting'
import { INITIAL_MATERIAL_REV } from '@/types/material'
import { normalizeMaterialRev, normalizeSnapshotItem } from '@/utils/master'

/** 本地结构版本号：新增/修改表结构时必须递增，并补充 upgrade 迁移 */
export const DB_VERSION = 3

/** 本地存储键名（localStorage 侧的少量元数据） */
export const LS_KEYS = {
  dbVersion: 'gbincense:db-version',
  lastBackupAt: 'gbincense:last-backup-at',
  uiPrefs: 'gbincense:ui-prefs'
} as const

export interface UiPrefs {
  /** 上次浏览的香方 */
  lastFormulaId: string | null
  /** 配比页排序方式：手动编排 / 按君臣佐使权重 */
  proportionSort: 'manual' | 'role'
  /** 窖藏页排序方式：按临近出窖 / 按入窖时间 */
  cellarSort: 'remain' | 'start'
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  lastFormulaId: null,
  proportionSort: 'manual',
  cellarSort: 'remain'
}

/** 快照结构，供 export.ts 与品香页使用 */
export interface IncenseSnapshot {
  app: 'gbincense'
  dbVersion: number
  exportedAt: string
  formulas: Formula[]
  materials: Material[]
  proportions: Proportion[]
  batches: Batch[]
  cellars: Cellar[]
  tastings: Tasting[]
}

export class IncenseDatabase extends Dexie {
  formulas!: Table<Formula, string>
  materials!: Table<Material, string>
  proportions!: Table<Proportion, string>
  batches!: Table<Batch, string>
  cellars!: Table<Cellar, string>
  tastings!: Table<Tasting, string>

  constructor() {
    super('gbincense')
    // v1：初版表结构，配比表尚未建立 seq 编排字段索引
    this.version(1).stores({
      formulas: 'id, name, scentType, usage, state, totalRatio',
      materials: 'id, name, origin, grade, processMethod',
      proportions: 'id, formulaId, materialId, role',
      batches: 'id, formulaId, mixedAt, formingMethod',
      cellars: 'id, batchId, startDate, endDate, state',
      tastings: 'id, batchId, tastedAt, smokeScore'
    })
    // v2：配比表补 seq 索引、批次与窖藏补日期索引，并回填历史脏数据
    this.version(2)
      .stores({
        formulas: 'id, name, scentType, usage, state, createdAt, totalRatio, updatedAt',
        materials: 'id, name, origin, grade, processMethod, updatedAt',
        proportions: 'id, formulaId, materialId, role, seq, updatedAt',
        batches: 'id, formulaId, mixedAt, formingMethod, updatedAt',
        cellars: 'id, batchId, startDate, endDate, state, updatedAt',
        tastings: 'id, batchId, tastedAt, smokeScore, updatedAt'
      })
      .upgrade(async (tx) => {
        // 迁移 1：v1 的配比记录没有 seq，按 formulaId 分组后按录入顺序补齐编排序号
        const grouped = new Map<string, Proportion[]>()
        await tx
          .table<Proportion>('proportions')
          .toCollection()
          .modify((proportion) => {
            if (typeof proportion.seq !== 'number' || Number.isNaN(proportion.seq)) {
              const list = grouped.get(proportion.formulaId) ?? []
              list.push(proportion)
              grouped.set(proportion.formulaId, list)
              proportion.seq = list.length
            }
            if (!Number.isFinite(proportion.updatedAt)) {
              proportion.updatedAt = Date.now()
            }
          })
        // 迁移 2：补齐批次缺失的快照字段，避免批次页对照时读到 undefined
        await tx
          .table<Batch>('batches')
          .toCollection()
          .modify((batch) => {
            if (!Array.isArray(batch.snapshot)) batch.snapshot = []
            if (typeof batch.snapshotAt !== 'number') batch.snapshotAt = 0
          })
        // 迁移 3：补齐品香评分的默认留香时长
        await tx
          .table<Tasting>('tastings')
          .toCollection()
          .modify((tasting) => {
            if (typeof tasting.lastingMin !== 'number' || Number.isNaN(tasting.lastingMin)) {
              tasting.lastingMin = 0
            }
          })
      })
    // v3：香料主档加 rev 修订号、配比加 materialRev 指针；
    // 历史数据没有修订号，升级时按当前值回填，并把批次快照补齐等级/炮制写法。
    this.version(DB_VERSION)
      .stores({
        formulas: 'id, name, scentType, usage, state, createdAt, totalRatio, updatedAt',
        materials: 'id, name, origin, grade, processMethod, rev, updatedAt',
        proportions: 'id, formulaId, materialId, role, materialRev, seq, updatedAt',
        batches: 'id, formulaId, mixedAt, formingMethod, updatedAt',
        cellars: 'id, batchId, startDate, endDate, state, updatedAt',
        tastings: 'id, batchId, tastedAt, smokeScore, updatedAt'
      })
      .upgrade(async (tx) => {
        // 主档按当前值回填修订号（历史数据即停在当前写法上）
        const materialList = await tx.table<Material>('materials').toArray()
        const byId = new Map<string, Material>(
          materialList.map((material) => [material.id, { ...material, rev: normalizeMaterialRev(material) }])
        )

        // 回填主档修订号
        await tx
          .table<Material>('materials')
          .toCollection()
          .modify((material) => {
            material.rev = byId.get(material.id)?.rev ?? INITIAL_MATERIAL_REV
          })

        // 配比回填 materialRev：按所引主档当前修订号回填
        await tx
          .table<Proportion>('proportions')
          .toCollection()
          .modify((proportion) => {
            if (typeof proportion.materialRev !== 'number' || Number.isNaN(proportion.materialRev)) {
              proportion.materialRev = byId.get(proportion.materialId)?.rev ?? INITIAL_MATERIAL_REV
            }
          })

        // 批次快照补齐等级/炮制/修订号：历史数据没有这些字段，统一按主档当前值回填
        // （已入窖批次从此刻起锁住回填时的写法，之后主档再改不会联动它）
        await tx
          .table<Batch>('batches')
          .toCollection()
          .modify((batch) => {
            if (!Array.isArray(batch.snapshot)) batch.snapshot = []
            if (typeof batch.snapshotAt !== 'number') batch.snapshotAt = 0
            batch.snapshot = batch.snapshot.map((item) => normalizeSnapshotItem(item, byId.get(item.materialId)))
          })
      })
  }
}

export const db = new IncenseDatabase()

/** 生成主键：短前缀 + 时间戳 + 随机串，避免多标签页写入冲突 */
export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${rand}`
}

/** 清空全部业务表，供「清空本地数据」与导入前的覆盖使用 */
export async function clearAllTables(): Promise<void> {
  await db.transaction(
    'rw',
    [db.formulas, db.materials, db.proportions, db.batches, db.cellars, db.tastings],
    async () => {
      await Promise.all([
        db.formulas.clear(),
        db.materials.clear(),
        db.proportions.clear(),
        db.batches.clear(),
        db.cellars.clear(),
        db.tastings.clear()
      ])
    }
  )
}

/** 各表记录数汇总，品香页与状态徽标消费 */
export async function countAll(): Promise<Record<string, number>> {
  const [formulas, materials, proportions, batches, cellars, tastings] = await Promise.all([
    db.formulas.count(),
    db.materials.count(),
    db.proportions.count(),
    db.batches.count(),
    db.cellars.count(),
    db.tastings.count()
  ])
  return { formulas, materials, proportions, batches, cellars, tastings }
}

/** 读取 localStorage 中的 UI 偏好 */
export function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(LS_KEYS.uiPrefs)
    if (!raw) return { ...DEFAULT_UI_PREFS }
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return {
      lastFormulaId: typeof parsed.lastFormulaId === 'string' ? parsed.lastFormulaId : null,
      proportionSort: parsed.proportionSort === 'role' ? 'role' : 'manual',
      cellarSort: parsed.cellarSort === 'start' ? 'start' : 'remain'
    }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

/** 写入 localStorage 中的 UI 偏好 */
export function writeUiPrefs(prefs: UiPrefs): void {
  localStorage.setItem(LS_KEYS.uiPrefs, JSON.stringify(prefs))
}

/** 记录数据库结构版本到 localStorage，便于品香页比对 */
export function stampDbVersion(): void {
  localStorage.setItem(LS_KEYS.dbVersion, String(DB_VERSION))
}

export function readStampedDbVersion(): number {
  const raw = localStorage.getItem(LS_KEYS.dbVersion)
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DB_VERSION
}

export function stampBackupTime(iso: string): void {
  localStorage.setItem(LS_KEYS.lastBackupAt, iso)
}

export function readLastBackupAt(): string | null {
  return localStorage.getItem(LS_KEYS.lastBackupAt)
}

/** 组装本地全部数据的快照对象 */
export async function exportSnapshot(): Promise<IncenseSnapshot> {
  const [formulas, materials, proportions, batches, cellars, tastings] = await Promise.all([
    db.formulas.toArray(),
    db.materials.toArray(),
    db.proportions.toArray(),
    db.batches.toArray(),
    db.cellars.toArray(),
    db.tastings.toArray()
  ])
  return {
    app: 'gbincense',
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    formulas,
    materials,
    proportions,
    batches,
    cellars,
    tastings
  }
}

/** 按主键 bulkPut 写入快照；overwrite 为 true 时先清空全部表 */
export async function importSnapshot(snapshot: IncenseSnapshot, overwrite = false): Promise<void> {
  if (overwrite) await clearAllTables()
  await db.transaction(
    'rw',
    [db.formulas, db.materials, db.proportions, db.batches, db.cellars, db.tastings],
    async () => {
      await db.formulas.bulkPut(snapshot.formulas)
      await db.materials.bulkPut(snapshot.materials)
      await db.proportions.bulkPut(snapshot.proportions)
      await db.batches.bulkPut(snapshot.batches)
      await db.cellars.bulkPut(snapshot.cellars)
      await db.tastings.bulkPut(snapshot.tastings)
    }
  )
}

/** 重置本地库：清空后重新播种演示档案 */
export async function resetDatabase(): Promise<void> {
  await clearAllTables()
  await seedDatabase()
}

/** 固定 id 前缀，保证重复播种幂等（bulkPut 覆盖同 id 记录） */
const SEED_IDS = {
  formulaLine: 'seed_formula_line',
  formulaPill: 'seed_formula_pill',
  formulaPlate: 'seed_formula_plate',
  materialChen: 'seed_material_chen',
  materialTan: 'seed_material_tan',
  materialRuxiang: 'seed_material_ruxiang',
  materialDing: 'seed_material_ding',
  batchLine: 'seed_batch_line',
  batchPill: 'seed_batch_pill',
  cellarLine: 'seed_cellar_line',
  cellarPill: 'seed_cellar_pill',
  tastingLine: 'seed_tasting_line',
  tastingPill: 'seed_tasting_pill'
} as const

/**
 * 播种三层互相引用的演示档案：香方（父）→ 配比 / 和香批次（子）→ 窖藏 / 品香（孙）。
 * 使用固定 id + bulkPut，重复调用不会产生重复数据。
 */
export async function seedDatabase(): Promise<void> {
  const now = Date.now()
  const lineRatio: Array<[string, string, number, Proportion['role'], string]> = [
    [SEED_IDS.materialChen, 'seed_prop_line_1', 45, '君', '陈化三年，去其燥气'],
    [SEED_IDS.materialTan, 'seed_prop_line_2', 30, '臣', '酒蒸后阴干，增其醇厚'],
    [SEED_IDS.materialRuxiang, 'seed_prop_line_3', 15, '佐', '乳香定香，缓其挥发'],
    [SEED_IDS.materialDing, 'seed_prop_line_4', 10, '使', '少许即足以引诸香']
  ]
  const pillRatio: Array<[string, string, number, Proportion['role'], string]> = [
    [SEED_IDS.materialChen, 'seed_prop_pill_1', 40, '君', '取沉水者，香气沉静'],
    [SEED_IDS.materialRuxiang, 'seed_prop_pill_2', 35, '臣', '炼蜜时后下，保其香'],
    [SEED_IDS.materialDing, 'seed_prop_pill_3', 25, '佐', '压模前拌入']
  ]

  const formulas: Formula[] = [
    {
      id: SEED_IDS.formulaLine,
      name: '静室安神线香',
      scentType: '线香',
      usage: '静室',
      createdAt: '2024-03-12',
      totalRatio: 100,
      state: '在用',
      updatedAt: now
    },
    {
      id: SEED_IDS.formulaPill,
      name: '礼佛沉香丸',
      scentType: '香丸',
      usage: '礼佛',
      createdAt: '2024-05-08',
      totalRatio: 100,
      state: '在用',
      updatedAt: now
    },
    {
      id: SEED_IDS.formulaPlate,
      name: '佩香辟秽盘香',
      scentType: '盘香',
      usage: '佩香',
      createdAt: '2024-08-21',
      totalRatio: 0,
      state: '草稿',
      updatedAt: now
    }
  ]

  const materials: Material[] = [
    {
      id: SEED_IDS.materialChen,
      name: '海南沉香',
      origin: '海南尖峰岭',
      grade: '特级',
      processMethod: '生用',
      aromaNote: '清甜带凉，尾韵有蔗糖气',
      createdAt: '2024-02-18',
      rev: INITIAL_MATERIAL_REV,
      updatedAt: now
    },
    {
      id: SEED_IDS.materialTan,
      name: '老山檀香',
      origin: '印度迈索尔',
      grade: '特级',
      processMethod: '酒蒸',
      aromaNote: '奶香厚重，留香绵长',
      createdAt: '2024-02-20',
      rev: INITIAL_MATERIAL_REV,
      updatedAt: now
    },
    {
      id: SEED_IDS.materialRuxiang,
      name: '乳香',
      origin: '阿曼佐法尔',
      grade: '一级',
      processMethod: '醋浸',
      aromaNote: '树脂清香，微带柑橘前调',
      createdAt: '2024-04-02',
      rev: INITIAL_MATERIAL_REV,
      updatedAt: now
    },
    {
      id: SEED_IDS.materialDing,
      name: '丁香',
      origin: '印尼马鲁古',
      grade: '二级',
      processMethod: '炒黄',
      aromaNote: '辛香穿透，少许即显',
      createdAt: '2024-04-06',
      rev: INITIAL_MATERIAL_REV,
      updatedAt: now
    }
  ]

  const proportions: Proportion[] = []
  const buildProportions = (
    formulaId: string,
    rows: Array<[string, string, number, Proportion['role'], string]>
  ): void => {
    rows.forEach((row, index) => {
      proportions.push({
        id: row[1],
        formulaId,
        materialId: row[0],
        ratio: row[2],
        role: row[3],
        note: row[4],
        materialRev: INITIAL_MATERIAL_REV,
        seq: index + 1,
        updatedAt: now
      })
    })
  }
  buildProportions(SEED_IDS.formulaLine, lineRatio)
  buildProportions(SEED_IDS.formulaPill, pillRatio)

  const toSnapshot = (rows: Array<[string, string, number, Proportion['role'], string]>) =>
    rows.map((row) => {
      const material = materials.find((item) => item.id === row[0])
      return {
        materialId: row[0],
        materialName: material?.name ?? '未知香料',
        ratio: row[2],
        role: row[3],
        grade: material?.grade ?? '—',
        processMethod: material?.processMethod ?? '—',
        materialRev: material?.rev ?? INITIAL_MATERIAL_REV
      }
    })

  const batches: Batch[] = [
    {
      id: SEED_IDS.batchLine,
      formulaId: SEED_IDS.formulaLine,
      mixedAt: '2024-04-01',
      formingMethod: '挤条',
      quantity: 320,
      operator: '林砚舟',
      snapshot: toSnapshot(lineRatio),
      snapshotAt: new Date('2024-04-01T09:00:00').getTime(),
      updatedAt: now
    },
    {
      id: SEED_IDS.batchPill,
      formulaId: SEED_IDS.formulaPill,
      mixedAt: '2024-06-15',
      formingMethod: '炼蜜成丸',
      quantity: 120,
      operator: '周若谷',
      snapshot: toSnapshot(pillRatio),
      snapshotAt: new Date('2024-06-15T14:30:00').getTime(),
      updatedAt: now
    }
  ]

  const cellars: Cellar[] = [
    {
      id: SEED_IDS.cellarLine,
      batchId: SEED_IDS.batchLine,
      startDate: '2024-04-05',
      endDate: '2024-10-05',
      temperatureC: 22.5,
      humidityPct: 58,
      container: '陶罐',
      state: '窖藏中',
      updatedAt: now
    },
    {
      id: SEED_IDS.cellarPill,
      batchId: SEED_IDS.batchPill,
      startDate: '2024-06-20',
      endDate: '2025-06-20',
      temperatureC: 19,
      humidityPct: 62,
      container: '锡罐',
      state: '已出窖',
      updatedAt: now
    }
  ]

  const tastings: Tasting[] = [
    {
      id: SEED_IDS.tastingLine,
      batchId: SEED_IDS.batchLine,
      tastedAt: '2024-07-02',
      aroma: '初闻清甜，中段檀香渐起，尾调沉静',
      lastingMin: 65,
      smokeScore: 9,
      comment: '烟气柔和，静室午后一炷最宜',
      updatedAt: now
    },
    {
      id: SEED_IDS.tastingPill,
      batchId: SEED_IDS.batchPill,
      tastedAt: '2024-09-11',
      aroma: '蜜香裹沉香，凉意收尾',
      lastingMin: 48,
      smokeScore: 8,
      comment: '丸体稍硬，可再陈三月',
      updatedAt: now
    }
  ]

  await db.transaction(
    'rw',
    [db.formulas, db.materials, db.proportions, db.batches, db.cellars, db.tastings],
    async () => {
      await db.formulas.bulkPut(formulas)
      await db.materials.bulkPut(materials)
      await db.proportions.bulkPut(proportions)
      await db.batches.bulkPut(batches)
      await db.cellars.bulkPut(cellars)
      await db.tastings.bulkPut(tastings)
    }
  )
}

/** 首屏初始化：打开数据库并在香方表为空时自动播种演示档案 */
export async function initDatabase(): Promise<void> {
  await db.open()
  if ((await db.formulas.count()) === 0) {
    await seedDatabase()
  }
}

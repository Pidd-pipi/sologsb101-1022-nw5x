import { INITIAL_MATERIAL_REVISION, type Material } from '@/types/material'
import type { Proportion } from '@/types/proportion'
import type { BatchSnapshotItem } from '@/types/batch'
import { round } from '@/utils/ratio'

/**
 * 主档一致性：香料主档（等级 / 炮制方式）的修订号机制。
 * 本文件只放无副作用的纯函数与冲突错误，DB 事务封装在 utils/masterSync.ts。
 */

/** 旧写法标记：快照引用的香料已从香料库删除时用 */
export const MATERIAL_REMOVED_WRITING = '已删除'

/** 读取香料修订号，历史脏数据缺字段时按起始修订号处理 */
export function revisionOf(material: Material | undefined | null): number {
  if (!material || !Number.isFinite(material.revision) || material.revision <= 0) {
    return INITIAL_MATERIAL_REVISION
  }
  return material.revision
}

/** 判断主档补丁是否改动了会影响「写法」的字段（仅等级 / 炮制方式） */
export function isWritingPatch(patch: Partial<Material>): boolean {
  return patch.grade !== undefined || patch.processMethod !== undefined
}

/** 构建 id → 香料 的映射，供快照重算与失效判断 */
export function buildMaterialMap(materials: Material[]): Map<string, Material> {
  const map = new Map<string, Material>()
  materials.forEach((material) => map.set(material.id, material))
  return map
}

/**
 * 按当前香方配比与最新主档生成未入窖批次的快照条目。
 * 配比是「当前方子」，主档提供等级 / 炮制写法，两者一主档修订号对齐。
 */
export function buildSnapshotItems(
  proportions: Proportion[],
  materialMap: Map<string, Material>
): BatchSnapshotItem[] {
  return [...proportions]
    .sort((a, b) => a.seq - b.seq)
    .map((proportion) => {
      const material = materialMap.get(proportion.materialId)
      return {
        materialId: proportion.materialId,
        materialName: material?.name ?? '未知香料',
        ratio: round(proportion.ratio, 2),
        role: proportion.role,
        grade: material?.grade ?? MATERIAL_REMOVED_WRITING,
        processMethod: material?.processMethod ?? MATERIAL_REMOVED_WRITING,
        materialRevision: revisionOf(material)
      }
    })
}

/** 快照单条是否停在旧主档写法上（修订号落后即失效） */
export function isSnapshotItemStale(item: BatchSnapshotItem, materialMap: Map<string, Material>): boolean {
  const material = materialMap.get(item.materialId)
  if (!material) return false
  return item.materialRevision !== revisionOf(material)
}

/** 统计快照中停在旧写法上的味数 */
export function countStaleSnapshotItems(items: BatchSnapshotItem[], materialMap: Map<string, Material>): number {
  return items.reduce((count, item) => count + (isSnapshotItemStale(item, materialMap) ? 1 : 0), 0)
}

/** 仅重算快照里某一味香材的写法（主档改名 / 改等级炮制后未入窖批次用） */
export function reconcileSnapshotItem(item: BatchSnapshotItem, material: Material | undefined): BatchSnapshotItem {
  if (!material) return item
  return {
    ...item,
    materialName: material.name,
    grade: material.grade,
    processMethod: material.processMethod,
    materialRevision: revisionOf(material)
  }
}

/** 两份快照内容（按 materialId 对齐后）是否一致，用于决定要不要写库 */
export function snapshotItemsEqual(a: BatchSnapshotItem[], b: BatchSnapshotItem[]): boolean {
  if (a.length !== b.length) return false
  const map = new Map(a.map((item) => [item.materialId, item]))
  return b.every((item) => {
    const prev = map.get(item.materialId)
    if (!prev) return false
    return (
      prev.materialName === item.materialName &&
      prev.ratio === item.ratio &&
      prev.role === item.role &&
      prev.grade === item.grade &&
      prev.processMethod === item.processMethod &&
      prev.materialRevision === item.materialRevision
    )
  })
}

/** 主档并发冲突：另一页面已改动主档，当前保存基于过期修订号 */
export class MasterConflictError extends Error {
  materialId: string
  /** 保存时依据的修订号 */
  expectedRevision: number
  /** 主档当前修订号 */
  actualRevision: number
  /** 最新主档（已被另一页面改动） */
  latest: Material | null

  constructor(params: {
    materialId: string
    expectedRevision: number
    actualRevision: number
    latest: Material | null
    message?: string
  }) {
    super(
      params.message ??
        `香料主档已在另一页面更新（修订号 ${params.expectedRevision} → ${params.actualRevision}），请按最新主档确认后重试`
    )
    this.name = 'MasterConflictError'
    this.materialId = params.materialId
    this.expectedRevision = params.expectedRevision
    this.actualRevision = params.actualRevision
    this.latest = params.latest
  }
}

export function isMasterConflictError(error: unknown): error is MasterConflictError {
  return error instanceof MasterConflictError
}

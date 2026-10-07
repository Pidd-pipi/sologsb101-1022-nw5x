import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import {
  createEmptyMaterialFilter,
  GRADE_WEIGHT,
  INITIAL_MATERIAL_REV,
  type Material,
  type MaterialFilterState,
  type MaterialGrade,
  type ProcessMethod
} from '@/types/material'
import type { Proportion, ProportionRole } from '@/types/proportion'
import { updateMaterialWithCascade, type MaterialCascadeResult } from '@/utils/master'

/** 香料库一行：香料 + 被引用情况 */
export interface MaterialRow {
  material: Material
  /** 被多少个香方引用 */
  formulaCount: number
  /** 引用它的香方 id 列表 */
  formulaIds: string[]
  /** 各香方中的占比合计 */
  ratioSum: number
  /** 在配比中承担的角色 */
  roles: ProportionRole[]
}

/**
 * 香料 store：维护香料库、炮制方式字典与检索条件，
 * 并统计每味香料被配比引用的情况（含引用香方）。
 */
export const useMaterialStore = defineStore('material', () => {
  const materialTable = useIdbTable<Material>((database) => database.materials)
  const proportionTable = useIdbTable<Proportion>((database) => database.proportions, {
    sortByUpdatedAt: false
  })

  const filter = ref<MaterialFilterState>(createEmptyMaterialFilter())
  const processMethodDictionary = ref<ProcessMethod[]>(['生用', '酒蒸', '蜜炙', '炒黄', '醋浸'])

  const materials = computed<Material[]>(() => materialTable.rows.value)
  const proportions = computed<Proportion[]>(() => proportionTable.rows.value)
  const loading = computed(() => materialTable.loading.value)
  const ready = computed(() => materialTable.ready.value)
  const error = computed(() => materialTable.error.value)

  /** 香料 id → 引用它的配比列表 */
  const proportionsByMaterial = computed<Record<string, Proportion[]>>(() => {
    const grouped: Record<string, Proportion[]> = {}
    proportions.value.forEach((proportion) => {
      const list = grouped[proportion.materialId] ?? []
      list.push(proportion)
      grouped[proportion.materialId] = list
    })
    return grouped
  })

  /** 香料库表格行：附带引用统计 */
  const rows = computed<MaterialRow[]>(() =>
    materials.value.map((material) => {
      const list = proportionsByMaterial.value[material.id] ?? []
      const formulaIds = Array.from(new Set(list.map((item) => item.formulaId)))
      return {
        material,
        formulaCount: formulaIds.length,
        formulaIds,
        ratioSum: Math.round(list.reduce((sum, item) => sum + item.ratio, 0) * 100) / 100,
        roles: Array.from(new Set(list.map((item) => item.role)))
      }
    })
  )

  /** 产地字典：由现有香料库动态汇总，作为筛选下拉的数据源 */
  const originDictionary = computed<string[]>(() =>
    Array.from(new Set(materials.value.map((material) => material.origin).filter((origin) => origin.length > 0))).sort()
  )

  /** 炮制方式字典：默认五种 + 库中实际出现过的取值 */
  const processDictionary = computed<ProcessMethod[]>(() =>
    Array.from(
      new Set<ProcessMethod>([
        ...processMethodDictionary.value,
        ...materials.value.map((material) => material.processMethod)
      ])
    )
  )

  const gradeCounts = computed<Record<MaterialGrade, number>>(() => {
    const counts: Record<MaterialGrade, number> = { 特级: 0, 一级: 0, 二级: 0 }
    materials.value.forEach((material) => {
      counts[material.grade] += 1
    })
    return counts
  })

  const methodCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    materials.value.forEach((material) => {
      counts[material.processMethod] = (counts[material.processMethod] ?? 0) + 1
    })
    return counts
  })

  const filteredRows = computed<MaterialRow[]>(() =>
    rows.value.filter((row) => {
      const { material } = row
      const keyword = filter.value.keyword.trim()
      if (keyword.length > 0) {
        const haystack = `${material.name}${material.origin}${material.grade}${material.processMethod}${material.aromaNote}`
        if (!haystack.includes(keyword)) return false
      }
      if (filter.value.grades.length > 0 && !filter.value.grades.includes(material.grade)) return false
      if (filter.value.origins.length > 0 && !filter.value.origins.includes(material.origin)) return false
      if (filter.value.processMethods.length > 0 && !filter.value.processMethods.includes(material.processMethod))
        return false
      return true
    })
  )

  const hasFilter = computed(
    () =>
      filter.value.keyword.trim().length > 0 ||
      filter.value.grades.length > 0 ||
      filter.value.origins.length > 0 ||
      filter.value.processMethods.length > 0
  )

  /** 未被任何配比引用的香料，删除时无需警告级联 */
  const unusedMaterials = computed(() => rows.value.filter((row) => row.formulaCount === 0).map((row) => row.material))

  const averageGradeWeight = computed(() => {
    if (materials.value.length === 0) return 0
    const sum = materials.value.reduce((acc, material) => acc + GRADE_WEIGHT[material.grade], 0)
    return Math.round((sum / materials.value.length) * 10) / 10
  })

  function patchFilter(patch: Partial<MaterialFilterState>): void {
    filter.value = { ...filter.value, ...patch }
  }

  function resetFilter(): void {
    filter.value = createEmptyMaterialFilter()
  }

  function materialById(id: string): Material | undefined {
    return materials.value.find((material) => material.id === id)
  }

  function materialName(id: string): string {
    return materialById(id)?.name ?? '香料已删除'
  }

  function referenceCount(materialId: string): number {
    return (proportionsByMaterial.value[materialId] ?? []).length
  }

  async function createMaterial(payload: {
    name: string
    origin: string
    grade: MaterialGrade
    processMethod: ProcessMethod
    aromaNote: string
    createdAt: string
  }): Promise<Material> {
    return materialTable.create(
      {
        name: payload.name.trim(),
        origin: payload.origin.trim(),
        grade: payload.grade,
        processMethod: payload.processMethod,
        aromaNote: payload.aromaNote.trim(),
        createdAt: payload.createdAt,
        rev: INITIAL_MATERIAL_REV
      },
      'material'
    )
  }

  /**
   * 更新香料主档。等级/炮制变化时联动失效重算（未固化配比与未入窖批次快照），
   * 已入窖批次锁住；expectedRev 与当前修订号不符时抛 MasterConflictError，由页面带草稿重试。
   */
  async function updateMaterial(
    id: string,
    patch: Partial<Material> & { expectedRev?: number }
  ): Promise<MaterialCascadeResult> {
    return updateMaterialWithCascade(id, patch)
  }

  /** 更新炮制方式（会推进修订号并联动重算）并同步到字典 */
  async function setProcessMethod(id: string, processMethod: ProcessMethod): Promise<MaterialCascadeResult> {
    const result = await updateMaterialWithCascade(id, { processMethod })
    if (!processMethodDictionary.value.includes(processMethod)) {
      processMethodDictionary.value = [...processMethodDictionary.value, processMethod]
    }
    return result
  }

  /** 删除香料：同时级联删除引用它的配比记录（配比合计会因此变化） */
  async function removeMaterial(
    id: string
  ): Promise<{ proportions: number; formulaIds: string[] }> {
    const list = proportionsByMaterial.value[id] ?? []
    const proportionIds = list.map((item) => item.id)
    const formulaIds = Array.from(new Set(list.map((item) => item.formulaId)))
    await db.transaction('rw', [db.materials, db.proportions], async () => {
      await db.proportions.bulkDelete(proportionIds)
      await db.materials.delete(id)
    })
    return { proportions: proportionIds.length, formulaIds }
  }

  /** 批量删除未被引用的香料，用于香料库清理 */
  async function removeUnused(): Promise<number> {
    const ids = unusedMaterials.value.map((material) => material.id)
    if (ids.length === 0) return 0
    await materialTable.bulkRemove(ids)
    return ids.length
  }

  return {
    materials,
    proportions,
    loading,
    ready,
    error,
    filter,
    rows,
    filteredRows,
    proportionsByMaterial,
    originDictionary,
    processDictionary,
    gradeCounts,
    methodCounts,
    hasFilter,
    unusedMaterials,
    averageGradeWeight,
    patchFilter,
    resetFilter,
    materialById,
    materialName,
    referenceCount,
    createMaterial,
    updateMaterial,
    setProcessMethod,
    removeMaterial,
    removeUnused
  }
})

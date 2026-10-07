<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Delete, Edit, Plus } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import GradeTag from '@/components/common/GradeTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useMaterialStore, type MaterialRow } from '@/stores/materialStore'
import { useFormulaStore } from '@/stores/formulaStore'
import {
  MATERIAL_GRADES,
  PROCESS_METHODS,
  type Material,
  type MaterialGrade,
  type MaterialFilterState,
  type ProcessMethod
} from '@/types/material'

const route = useRoute()
const router = useRouter()
const materialStore = useMaterialStore()
const formulaStore = useFormulaStore()

const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<{
  name: string
  origin: string
  grade: MaterialGrade
  processMethod: ProcessMethod
  aromaNote: string
  createdAt: string
}>({
  name: '',
  origin: '',
  grade: '一级',
  processMethod: '生用',
  aromaNote: '',
  createdAt: new Date().toISOString().slice(0, 10)
})

const rules: FormRules = {
  name: [
    { required: true, message: '请填写香料名', trigger: 'blur' },
    { min: 1, max: 20, message: '香料名长度 1 ~ 20 字', trigger: 'blur' }
  ],
  origin: [{ required: true, message: '请填写产地', trigger: 'blur' }],
  grade: [{ required: true, message: '请选择等级', trigger: 'change' }],
  processMethod: [{ required: true, message: '请选择炮制方式', trigger: 'change' }]
}

const filterModel = computed<FilterModel>(() => ({
  keyword: materialStore.filter.keyword,
  grade: materialStore.filter.grades,
  origin: materialStore.filter.origins,
  process: materialStore.filter.processMethods
}))

const filterSelects = computed(() => [
  { key: 'grade', label: '等级', options: MATERIAL_GRADES.map((item) => ({ label: item, value: item })) },
  {
    key: 'origin',
    label: '产地',
    options: materialStore.originDictionary.map((item) => ({ label: item, value: item }))
  },
  {
    key: 'process',
    label: '炮制',
    options: materialStore.processDictionary.map((item) => ({ label: item, value: item }))
  }
])

function pushQuery(): void {
  const query: Record<string, string> = {}
  const { keyword, grades, origins, processMethods } = materialStore.filter
  if (keyword.trim()) query.kw = keyword.trim()
  if (grades.length) query.grade = grades.join(',')
  if (origins.length) query.origin = origins.join(',')
  if (processMethods.length) query.process = processMethods.join(',')
  void router.replace({ query })
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.length > 0) return value.split(',').filter((item) => item.length > 0)
  return []
}

function readQuery(): void {
  const query = route.query
  materialStore.patchFilter({
    keyword: typeof query.kw === 'string' ? query.kw : '',
    grades: toArray(query.grade).filter((item): item is MaterialGrade => (MATERIAL_GRADES as string[]).includes(item)),
    origins: toArray(query.origin),
    processMethods: toArray(query.process).filter((item): item is ProcessMethod =>
      (PROCESS_METHODS as string[]).includes(item)
    )
  })
}

if (Object.keys(route.query).length > 0) readQuery()

watch(
  () => route.query,
  (query) => {
    if (Object.keys(query).length === 0 && materialStore.hasFilter) {
      materialStore.resetFilter()
      return
    }
    readQuery()
  }
)

const rows = computed<MaterialRow[]>(() => materialStore.filteredRows)

function handleFilterChange(value: FilterModel): void {
  const next: Partial<MaterialFilterState> = {
    keyword: value.keyword,
    grades: Array.isArray(value.grade) ? (value.grade as MaterialGrade[]) : [],
    origins: Array.isArray(value.origin) ? (value.origin as string[]) : [],
    processMethods: Array.isArray(value.process) ? (value.process as ProcessMethod[]) : []
  }
  materialStore.patchFilter(next)
  pushQuery()
}

function handleReset(): void {
  materialStore.resetFilter()
  pushQuery()
}

function openCreate(): void {
  editingId.value = null
  form.name = ''
  form.origin = ''
  form.grade = '一级'
  form.processMethod = '生用'
  form.aromaNote = ''
  form.createdAt = new Date().toISOString().slice(0, 10)
  dialogVisible.value = true
}

function openEdit(material: Material): void {
  editingId.value = material.id
  form.name = material.name
  form.origin = material.origin
  form.grade = material.grade
  form.processMethod = material.processMethod
  form.aromaNote = material.aromaNote
  form.createdAt = material.createdAt
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      const result = await materialStore.updateMaterial(editingId.value, {
        name: form.name.trim(),
        origin: form.origin.trim(),
        grade: form.grade,
        processMethod: form.processMethod,
        aromaNote: form.aromaNote.trim(),
        createdAt: form.createdAt
      })
      if (result.writingChanged) {
        ElMessage.success(
          `香料信息已更新（修订号升至 v${result.revision}），${result.recalcedBatches} 个未入窖批次快照已按最新主档重算；已入窖批次保留当时写法`
        )
      } else {
        ElMessage.success('香料信息已更新')
      }
    } else {
      await materialStore.createMaterial({
        name: form.name,
        origin: form.origin,
        grade: form.grade,
        processMethod: form.processMethod,
        aromaNote: form.aromaNote,
        createdAt: form.createdAt
      })
      ElMessage.success(`已入库香料「${form.name.trim()}」`)
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function changeProcess(row: MaterialRow, method: ProcessMethod): Promise<void> {
  if (row.material.processMethod === method) return
  const result = await materialStore.setProcessMethod(row.material.id, method)
  ElMessage.success(
    `「${row.material.name}」炮制方式已改为「${method}」（修订号 v${result.revision}），${result.recalcedBatches} 个未入窖批次快照已重算`
  )
}

async function removeMaterial(row: MaterialRow): Promise<void> {
  const message =
    row.formulaCount === 0
      ? `删除香料「${row.material.name}」？该香料尚未被任何配比引用。`
      : `删除香料「${row.material.name}」将同时删除 ${row.formulaCount} 款香方下的配比记录（配比合计会随之变化），是否继续？`
  const confirmed = await ElMessageBox.confirm(message, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消'
  }).catch(() => false)
  if (!confirmed) return
  const result = await materialStore.removeMaterial(row.material.id)
  ElMessage.success(
    `已删除香料，连带清除配比 ${result.proportions} 条，${result.recalcedBatches} 个未入窖批次快照已重算`
  )
}

async function removeUnused(): Promise<void> {
  const count = await materialStore.removeUnused()
  if (count === 0) {
    ElMessage.info('没有被引用之外的闲置香料')
    return
  }
  ElMessage.success(`已清理 ${count} 味未被配比引用的香料`)
}

function consumedBy(row: MaterialRow): string {
  if (row.formulaIds.length === 0) return '未被引用'
  return row.formulaIds.map((id) => formulaStore.formulaName(id)).join('、')
}
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>香料库与炮制方式</h2>
        <p>
          共 {{ materialStore.materials.length }} 味香料 · 特级 {{ materialStore.gradeCounts['特级'] }} 味 · 产地
          {{ materialStore.originDictionary.length }} 处 · 闲置 {{ materialStore.unusedMaterials.length }} 味
        </p>
      </div>
      <div class="page-title__actions">
        <el-button :icon="Delete" @click="removeUnused">清理闲置香料</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增香料</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="香料总数" :value="materialStore.materials.length" suffix="味" icon="Files" tone="primary" />
      <StatBadge label="特级" :value="materialStore.gradeCounts['特级']" suffix="味" icon="Histogram" tone="success" />
      <StatBadge label="一级" :value="materialStore.gradeCounts['一级']" suffix="味" icon="DataLine" tone="warning" />
      <StatBadge label="二级" :value="materialStore.gradeCounts['二级']" suffix="味" icon="PieChart" tone="info" />
      <StatBadge
        label="被引用"
        :value="materialStore.materials.length - materialStore.unusedMaterials.length"
        suffix="味"
        icon="TrendCharts"
        tone="success"
      />
      <StatBadge label="产地数" :value="materialStore.originDictionary.length" suffix="处" icon="Coin" tone="primary" />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="按香料名 / 产地 / 香气特征搜索"
      @change="handleFilterChange"
      @reset="handleReset"
    />

    <div class="section-card material-table">
      <div v-if="rows.length === 0" class="material-empty">
        <EmptyPanel
          title="香料库暂无记录"
          :description="
            materialStore.materials.length === 0
              ? '先入库几味香材：登记产地、等级与炮制方式后，即可在配比页按君臣佐使编排。'
              : '当前筛选条件下没有匹配的香料，可重置条件或新增一味。'
          "
          action-text="新增香料"
          @action="openCreate"
        />
      </div>

      <el-table v-else :data="rows" row-key="material.id" stripe>
        <el-table-column label="香料" min-width="150">
          <template #default="{ row }: { row: MaterialRow }">
            <div class="cell-main">{{ row.material.name }}</div>
            <div class="cell-sub muted">{{ row.material.aromaNote || '未记录香气特征' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="产地" prop="material.origin" min-width="120" />
        <el-table-column label="等级" width="120">
          <template #default="{ row }: { row: MaterialRow }">
            <GradeTag :grade="row.material.grade" plain size="small" />
          </template>
        </el-table-column>
        <el-table-column label="炮制方式" width="150">
          <template #default="{ row }: { row: MaterialRow }">
            <el-select
              :model-value="row.material.processMethod"
              size="small"
              style="width: 120px"
              @update:model-value="(value: ProcessMethod) => changeProcess(row, value)"
            >
              <el-option v-for="item in PROCESS_METHODS" :key="item" :label="item" :value="item" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="主档版本" width="100">
          <template #default="{ row }: { row: MaterialRow }">
            <el-tag size="small" effect="plain" type="info" round>v{{ row.material.revision }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="引用香方" min-width="200">
          <template #default="{ row }: { row: MaterialRow }">
            <div class="cell-sub">{{ consumedBy(row) }}</div>
            <div class="cell-sub muted">
              引用 {{ row.formulaCount }} 款 · 占比合计 {{ row.ratioSum }}%
              <template v-if="row.roles.length"> · {{ row.roles.join('/') }}</template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="入库日期" prop="material.createdAt" width="120" />
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }: { row: MaterialRow }">
            <el-button size="small" :icon="Edit" text type="primary" @click="openEdit(row.material)">编辑</el-button>
            <el-button size="small" :icon="Delete" text type="danger" @click="removeMaterial(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑香料' : '新增香料'" width="560px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="香料名" prop="name">
          <el-input v-model="form.name" placeholder="如：海南沉香" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="产地" prop="origin">
          <el-input v-model="form.origin" placeholder="如：海南尖峰岭" maxlength="30" />
        </el-form-item>
        <el-form-item label="等级" prop="grade">
          <el-radio-group v-model="form.grade">
            <el-radio v-for="item in MATERIAL_GRADES" :key="item" :value="item">{{ item }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="炮制方式" prop="processMethod">
          <el-select v-model="form.processMethod" style="width: 100%">
            <el-option v-for="item in PROCESS_METHODS" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="香气特征" prop="aromaNote">
          <el-input
            v-model="form.aromaNote"
            type="textarea"
            :rows="3"
            maxlength="80"
            show-word-limit
            placeholder="如：清甜带凉，尾韵有蔗糖气"
          />
        </el-form-item>
        <el-form-item label="入库日期" prop="createdAt">
          <el-date-picker
            v-model="form.createdAt"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            placeholder="选择入库日期"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ editingId ? '保存修改' : '入库' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.material-table {
  margin-top: 16px;
}

.material-empty {
  padding: 8px 0;
}

.cell-main {
  font-weight: 600;
}

.cell-sub {
  font-size: 12px;
  line-height: 1.6;
}
</style>

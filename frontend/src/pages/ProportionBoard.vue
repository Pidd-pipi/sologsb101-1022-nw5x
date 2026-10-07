<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Delete, Edit, Plus, Rank, Sort, TrendCharts } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import GradeTag from '@/components/common/GradeTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useFormulaStore } from '@/stores/formulaStore'
import { useMaterialStore } from '@/stores/materialStore'
import { useProportionStore } from '@/stores/proportionStore'
import { useProportion, type ProportionRow } from '@/hooks/useProportion'
import { isMasterConflictError } from '@/utils/master'
import { PROPORTION_ROLES, ROLE_COLOR, ROLE_HINT, type ProportionRole } from '@/types/proportion'
import { MATERIAL_GRADES } from '@/types/material'
import { formatPercent, round } from '@/utils/ratio'

const route = useRoute()
const router = useRouter()
const formulaStore = useFormulaStore()
const materialStore = useMaterialStore()
const proportionStore = useProportionStore()
const { rows, rolePreview, total, gap, checkLevel, checkMessage, add, update, remove, rescale, sortByRole, reorder, clearFormula } =
  useProportion()

const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
/** 编辑弹窗里当前所选香料开弹窗时的主档修订号，换香料保存时做乐观并发校验 */
const expectedMaterialRev = ref(1)
/** 保存时发现所选香料主档已被别处升版：保留草稿，展示冲突并允许重试 */
const conflict = ref<string | null>(null)

const form = reactive<{
  materialId: string
  ratio: number
  role: ProportionRole
  note: string
}>({
  materialId: '',
  ratio: 10,
  role: '君',
  note: ''
})

const rules: FormRules = {
  materialId: [{ required: true, message: '请选择香料', trigger: 'change' }],
  role: [{ required: true, message: '请选择君臣佐使定位', trigger: 'change' }],
  ratio: [
    { required: true, message: '请填写占比', trigger: 'blur' },
    {
      validator: (_rule, value: number, callback: (error?: Error) => void) => {
        if (!Number.isFinite(value) || value <= 0) callback(new Error('占比需大于 0'))
        else if (value > 100) callback(new Error('单味占比不得超过 100%'))
        else callback()
      },
      trigger: 'blur'
    }
  ]
}

const formulaOptions = computed(() =>
  formulaStore.formulas.map((formula) => ({
    label: `${formula.name}（${formula.scentType} · ${formula.state}）`,
    value: formula.id
  }))
)

watch(
  () => [formulaStore.currentFormulaId, formulaStore.formulas.length] as const,
  () => {
    if (!formulaStore.currentFormulaId && formulaStore.formulas.length > 0) {
      formulaStore.setCurrentFormula(formulaStore.formulas[0].id)
    }
  },
  { immediate: true }
)

// 把配比条数同步给香方台账卡片
watch(
  () => proportionStore.materialCountMap,
  (map) => formulaStore.setMaterialCountMap(map),
  { immediate: true, deep: true }
)

const filterModel = computed<FilterModel>(() => ({
  keyword: proportionStore.filter.keyword,
  role: proportionStore.filter.roles,
  grade: proportionStore.filter.grades
}))

const filterSelects = computed(() => [
  { key: 'role', label: '君臣佐使', options: PROPORTION_ROLES.map((item) => ({ label: item, value: item })) },
  { key: 'grade', label: '香料等级', options: MATERIAL_GRADES.map((item) => ({ label: item, value: item })) }
])

const queryReady = ref(false)

function pushQuery(): void {
  const query: Record<string, string> = {}
  const { keyword, roles, grades } = proportionStore.filter
  const formulaId = formulaStore.currentFormulaId
  if (formulaId) query.formula = formulaId
  if (keyword.trim()) query.kw = keyword.trim()
  if (roles.length) query.role = roles.join(',')
  if (grades.length) query.grade = grades.join(',')
  void router.replace({ query })
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.length > 0) return value.split(',').filter((item) => item.length > 0)
  return []
}

function readQuery(): void {
  const query = route.query
  if (typeof query.formula === 'string' && query.formula.length > 0) {
    formulaStore.setCurrentFormula(query.formula)
  }
  proportionStore.patchFilter({
    keyword: typeof query.kw === 'string' ? query.kw : '',
    roles: toArray(query.role).filter((item): item is ProportionRole => (PROPORTION_ROLES as string[]).includes(item)),
    grades: toArray(query.grade)
  })
}

if (Object.keys(route.query).length > 0) readQuery()
queryReady.value = true

watch(
  () => route.query,
  (query) => {
    if (Object.keys(query).length === 0 && proportionStore.hasFilter) {
      proportionStore.resetFilter()
      return
    }
    readQuery()
  }
)

watch(
  () => formulaStore.currentFormulaId,
  () => {
    if (queryReady.value) pushQuery()
  }
)

const visibleRows = computed<ProportionRow[]>(() => {
  const list = proportionStore.sortMode === 'role' ? rolePreview.value : rows.value
  const keyword = proportionStore.filter.keyword.trim()
  return list.filter((row) => {
    if (keyword.length > 0) {
      const haystack = `${row.materialName}${row.origin}${row.role}${row.proportion.note}`
      if (!haystack.includes(keyword)) return false
    }
    if (proportionStore.filter.roles.length > 0 && !proportionStore.filter.roles.includes(row.role)) return false
    if (proportionStore.filter.grades.length > 0 && !proportionStore.filter.grades.includes(row.grade)) return false
    return true
  })
})

const materialOptions = computed(() =>
  materialStore.materials.map((material) => ({
    label: `${material.name}（${material.grade} · ${material.processMethod} · ${material.origin}）`,
    value: material.id
  }))
)

const roleCounts = computed(() => proportionStore.roleCounts)

const totalPercent = computed(() => formatPercent(total.value, 2))

/** 一键等比缩放的预设倍数 */
const SCALE_PRESETS = [0.5, 0.8, 1.2, 1.5]

function handleFilterChange(value: FilterModel): void {
  proportionStore.patchFilter({
    keyword: value.keyword,
    roles: Array.isArray(value.role) ? (value.role as ProportionRole[]) : [],
    grades: Array.isArray(value.grade) ? (value.grade as string[]) : []
  })
  pushQuery()
}

function handleReset(): void {
  proportionStore.resetFilter()
  pushQuery()
}

function changeFormula(value: string): void {
  formulaStore.setCurrentFormula(value)
  pushQuery()
}

function openCreate(): void {
  if (!formulaStore.currentFormulaId) {
    ElMessage.warning('请先选择或新建一款香方')
    return
  }
  editingId.value = null
  conflict.value = null
  form.materialId = materialStore.materials[0]?.id ?? ''
  expectedMaterialRev.value = materialStore.materials[0]?.rev ?? 1
  form.ratio = 10
  form.role = '君'
  form.note = ''
  dialogVisible.value = true
}

function openEdit(row: ProportionRow): void {
  editingId.value = row.proportion.id
  conflict.value = null
  form.materialId = row.proportion.materialId
  expectedMaterialRev.value = row.materialRev ?? row.proportion.materialRev
  form.ratio = row.ratio
  form.role = row.role
  form.note = row.proportion.note
  dialogVisible.value = true
}

/** 弹窗里更换所选香料时，记下新香料当前主档修订号 */
function onMaterialChange(materialId: string): void {
  conflict.value = null
  expectedMaterialRev.value = materialStore.materialById(materialId)?.rev ?? 1
}

async function submitForm(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      await update(
        editingId.value,
        {
          materialId: form.materialId,
          ratio: form.ratio,
          role: form.role,
          note: form.note
        },
        { expectedMaterialRev: expectedMaterialRev.value }
      )
      ElMessage.success('配比已更新')
    } else {
      await add({ materialId: form.materialId, ratio: form.ratio, role: form.role, note: form.note })
      ElMessage.success('已加入配比，可继续调整占比')
    }
    conflict.value = null
    dialogVisible.value = false
  } catch (err) {
    if (isMasterConflictError(err)) {
      // 另一开着的页面刚升过这味香料的主档：草稿保留，按最新主档重算后重试
      expectedMaterialRev.value = err.actualRev
      conflict.value = err.message
      ElMessage.warning('该香料主档已被别处改动，页面已按最新主档重算，草稿已保留，确认后可重试')
    } else {
      throw err
    }
  } finally {
    submitting.value = false
  }
}

async function quickRatio(row: ProportionRow, value: number): Promise<void> {
  const next = round(value, 2)
  if (next === row.ratio) return
  await update(row.proportion.id, { ratio: next })
  if (next < 0 || next > 100) {
    ElMessage.warning('占比应在 0 ~ 100 之间')
    return
  }
  ElMessage.success(`「${row.materialName}」占比改为 ${next}%`)
}

async function removeRow(row: ProportionRow): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `从当前香方中移除「${row.materialName}」的配比？`,
    '删除确认',
    { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await remove(row.proportion.id)
  ElMessage.success('配比已移除')
}

async function doRescale(factor: number): Promise<void> {
  if (rows.value.length === 0) {
    ElMessage.warning('当前香方还没有配比可缩放')
    return
  }
  const count = await rescale(factor)
  ElMessage.success(
    factor === 1 ? `已按等比归一化 ${count} 条配比，合计校准为 100%` : `已按 ×${factor} 等比缩放 ${count} 条配比`
  )
}

async function doSortByRole(): Promise<void> {
  if (rows.value.length === 0) {
    ElMessage.warning('当前香方还没有配比可排序')
    return
  }
  await sortByRole()
  ElMessage.success('已按君臣佐使权重（君 > 臣 > 佐 > 使）重排并写回编排顺序')
}

async function clearAll(): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `清空「${formulaStore.currentFormula?.name ?? '当前香方'}」的全部配比？合计将归零。`,
    '清空确认',
    { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  const count = await clearFormula()
  ElMessage.success(`已清空 ${count} 条配比`)
}

function onDragStart(row: ProportionRow): void {
  draggingId.value = row.proportion.id
}

function onDragOver(row: ProportionRow, event: DragEvent): void {
  event.preventDefault()
  dragOverId.value = row.proportion.id
}

async function onDrop(target: ProportionRow): Promise<void> {
  const sourceId = draggingId.value
  draggingId.value = null
  dragOverId.value = null
  if (!sourceId || sourceId === target.proportion.id) return
  const ordered = visibleRows.value.map((row) => row.proportion.id).filter((id) => id !== sourceId)
  const targetIndex = ordered.indexOf(target.proportion.id)
  ordered.splice(targetIndex, 0, sourceId)
  await reorder(ordered)
  ElMessage.success('君臣佐使编排顺序已按拖拽结果写回')
}

function onDragEnd(): void {
  draggingId.value = null
  dragOverId.value = null
}

const roleHint = (role: ProportionRole): string => ROLE_HINT[role]
const roleColor = (role: ProportionRole): string => ROLE_COLOR[role]
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>配比与君臣佐使编排</h2>
        <p>
          当前香方：{{ formulaStore.currentFormula ? formulaStore.currentFormula.name : '未选择' }} ·
          {{ rows.length }} 味配比 · 合计 {{ totalPercent }} · 排序方式
          {{ proportionStore.sortMode === 'role' ? '君臣佐使权重' : '手动编排' }}
        </p>
      </div>
      <div class="page-title__actions">
        <el-button :icon="Sort" @click="doSortByRole">按君臣佐使重排</el-button>
        <el-button :icon="TrendCharts" @click="doRescale(1)">一键等比缩放至 100%</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增配比</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge
        label="配比合计"
        :value="total"
        suffix="%"
        :tone="checkLevel === 'ok' ? 'success' : checkLevel === 'warn' ? 'warning' : 'danger'"
        icon="Histogram"
        :percent="Math.min(100, total)"
      />
      <StatBadge
        label="与 100% 偏差"
        :value="gap"
        suffix="%"
        :tone="gap === 0 ? 'success' : 'danger'"
        icon="WarningFilled"
      />
      <StatBadge label="配比味数" :value="rows.length" suffix="味" icon="Files" tone="info" />
      <StatBadge label="君" :value="roleCounts['君']" suffix="味" icon="TrendCharts" tone="primary" />
      <StatBadge label="臣" :value="roleCounts['臣']" suffix="味" icon="PieChart" tone="warning" />
      <StatBadge label="佐 / 使" :value="`${roleCounts['佐']} / ${roleCounts['使']}`" icon="DataLine" tone="default" />
    </div>

    <div class="check-strip" :class="`is-${checkLevel}`">
      <el-icon><Histogram /></el-icon>
      <span>{{ checkMessage }}</span>
      <span class="muted">
        拖动手柄可调整君臣佐使编排顺序，排序结果会写回本地数据库；等比缩放会按比例重新分配全部占比。
      </span>
    </div>

    <div class="section-card">
      <div class="section-card__head">
        <h3>香方选择与筛选</h3>
        <div class="toolbar">
          <el-select
            :model-value="formulaStore.currentFormulaId ?? ''"
            placeholder="选择香方"
            style="width: 260px"
            @update:model-value="changeFormula"
          >
            <el-option v-for="item in formulaOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-dropdown trigger="click" @command="(factor: number) => doRescale(factor)">
            <el-button>
              等比缩放
              <el-icon class="el-icon--right"><Rank /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="preset in SCALE_PRESETS" :key="preset" :command="preset">
                  ×{{ preset }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button type="danger" plain :icon="Delete" @click="clearAll">清空配比</el-button>
        </div>
      </div>

      <FilterBar
        :model-value="filterModel"
        :selects="filterSelects"
        keyword-placeholder="按香料名 / 产地 / 备注搜索"
        @change="handleFilterChange"
        @reset="handleReset"
      />
    </div>

    <div class="section-card">
      <div v-if="visibleRows.length === 0" class="proportion-empty">
        <EmptyPanel
          title="当前香方暂无配比"
          :description="
            formulaStore.formulas.length === 0
              ? '还没有香方：请先到「香方台账」新建一款香方，再回来编排君臣佐使。'
              : '可新增配比并设定占比，合计需等于 100%；也可用「一键等比缩放」自动归一化。'
          "
          :action-text="formulaStore.formulas.length === 0 ? '' : '新增配比'"
          secondary-text="前往香方台账"
          @action="openCreate"
          @secondary="router.push('/formulas')"
        />
      </div>

      <div v-else class="drag-list">
        <div class="drag-list__head">
          <span class="drag-list__handle-col">编排</span>
          <span class="drag-list__name-col">香料</span>
          <span class="drag-list__role-col">君臣佐使</span>
          <span class="drag-list__ratio-col">占比 %</span>
          <span class="drag-list__note-col">备注</span>
          <span class="drag-list__action-col">操作</span>
        </div>

        <div
          v-for="row in visibleRows"
          :key="row.proportion.id"
          class="drag-row"
          :class="{
            'is-dragging': draggingId === row.proportion.id,
            'is-over': dragOverId === row.proportion.id
          }"
          draggable="true"
          @dragstart="onDragStart(row)"
          @dragover="onDragOver(row, $event)"
          @drop="onDrop(row)"
          @dragend="onDragEnd"
        >
          <span class="drag-row__handle" :title="`当前编排序号 ${row.proportion.seq}`">
            <el-icon><Rank /></el-icon>
            {{ row.proportion.seq }}
          </span>
          <span class="drag-row__name">
            <strong>{{ row.materialName }}</strong>
            <span class="drag-row__sub muted">{{ row.origin }} · {{ row.processMethod }}</span>
            <GradeTag v-if="row.grade !== '未知'" :grade="row.grade" plain size="small" />
            <el-tag v-if="row.stale" type="warning" size="small" effect="plain" round>写法已落后主档，待重算</el-tag>
            <el-tag v-else size="small" effect="plain" round class="rev-tag">主档 v{{ row.materialRev ?? '—' }}</el-tag>
          </span>
          <span class="drag-row__role">
            <el-tag :style="{ backgroundColor: roleColor(row.role), color: '#fff', borderColor: roleColor(row.role) }" round>
              {{ row.role }}
            </el-tag>
            <span class="drag-row__sub muted">{{ roleHint(row.role) }}</span>
          </span>
          <span class="drag-row__ratio">
            <el-input-number
              :model-value="row.ratio"
              :min="0"
              :max="100"
              :step="1"
              :precision="2"
              size="small"
              controls-position="right"
              style="width: 130px"
              @change="(value: number | undefined) => quickRatio(row, value ?? 0)"
            />
          </span>
          <span class="drag-row__note">
            <el-input
              :model-value="row.proportion.note"
              size="small"
              placeholder="炮制要点 / 替代香材"
              @change="(value: string) => update(row.proportion.id, { note: value })"
            />
          </span>
          <span class="drag-row__action">
            <el-button size="small" text type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="removeRow(row)">移除</el-button>
          </span>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑配比' : '新增配比'" width="560px" append-to-body>
      <el-alert
        v-if="conflict"
        class="conflict-alert"
        type="warning"
        :closable="false"
        show-icon
        title="保存失败：所选香料主档已被别处升版"
        :description="conflict"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="104px">
        <el-form-item label="香料" prop="materialId">
          <el-select
            v-model="form.materialId"
            filterable
            placeholder="选择香料"
            style="width: 100%"
            @update:model-value="(value: string) => onMaterialChange(value)"
          >
            <el-option v-for="item in materialOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="君臣佐使" prop="role">
          <el-radio-group v-model="form.role">
            <el-radio v-for="item in PROPORTION_ROLES" :key="item" :value="item">
              {{ item }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="占比 %" prop="ratio">
          <el-input-number v-model="form.ratio" :min="0" :max="100" :step="1" :precision="2" style="width: 200px" />
          <span class="muted form-hint">同香方全部占比合计需等于 100%</span>
        </el-form-item>
        <el-form-item label="备注" prop="note">
          <el-input v-model="form.note" type="textarea" :rows="3" maxlength="60" show-word-limit placeholder="如：陈化三年，去其燥气" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ conflict ? '带着草稿按最新主档重试' : editingId ? '保存修改' : '加入配比' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.check-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #ffffff;
  font-size: 13px;
}

.check-strip.is-ok {
  border-color: #bfe3cb;
  background: #f2faf4;
  color: #1e8449;
}

.check-strip.is-warn {
  border-color: #f0dcb4;
  background: #fdf8ee;
  color: #a9741a;
}

.check-strip.is-error {
  border-color: #f0c4bd;
  background: #fdf1ef;
  color: #c0392b;
}

.proportion-empty {
  padding: 8px 0;
}

.drag-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drag-list__head,
.drag-row {
  display: grid;
  grid-template-columns: 80px 1.6fr 1.2fr 150px 1.6fr 150px;
  align-items: center;
  gap: 10px;
}

.drag-list__head {
  padding: 6px 12px;
  font-size: 12px;
  color: #8c8479;
  border-bottom: 1px solid var(--line);
}

.drag-row {
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: grab;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
}

.drag-row:hover {
  border-color: #d6c3a5;
}

.drag-row.is-dragging {
  opacity: 0.5;
}

.drag-row.is-over {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(138, 90, 43, 0.16);
}

.drag-row__handle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--brand);
  font-variant-numeric: tabular-nums;
}

.drag-row__name,
.drag-row__role {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.drag-row__sub {
  font-size: 12px;
}

.form-hint {
  margin-left: 10px;
  font-size: 12px;
}

.conflict-alert {
  margin-bottom: 14px;
}

.rev-tag {
  font-variant-numeric: tabular-nums;
}
</style>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Download, Edit, Histogram, Plus, Refresh, Upload } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import GradeTag from '@/components/common/GradeTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useFormulaStore } from '@/stores/formulaStore'
import { useProportionStore } from '@/stores/proportionStore'
import { exportFormulaJson, importFormulaPayload, readFileText, validateFormulaJson } from '@/utils/export'
import { resetDatabase } from '@/utils/db'
import { round } from '@/utils/ratio'
import {
  FORMULA_STATES,
  SCENT_TYPES,
  USAGE_SCENES,
  type Formula,
  type FormulaCard,
  type FormulaState,
  type ScentType,
  type UsageScene
} from '@/types/formula'

const route = useRoute()
const router = useRouter()
const formulaStore = useFormulaStore()
const proportionStore = useProportionStore()

const dialogVisible = ref(false)
const importVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const importText = ref('')
const importFileName = ref('')

const form = reactive<{
  name: string
  scentType: ScentType
  usage: UsageScene
  state: FormulaState
  createdAt: string
}>({
  name: '',
  scentType: '线香',
  usage: '静室',
  state: '草稿',
  createdAt: new Date().toISOString().slice(0, 10)
})

const rules: FormRules = {
  name: [
    { required: true, message: '请填写香方名', trigger: 'blur' },
    { min: 2, max: 30, message: '香方名长度 2 ~ 30 字', trigger: 'blur' }
  ],
  createdAt: [{ required: true, message: '请选择创方日期', trigger: 'change' }]
}

const filterModel = computed<FilterModel>(() => ({
  keyword: formulaStore.filter.keyword,
  scentType: formulaStore.filter.scentTypes,
  usage: formulaStore.filter.usages,
  state: formulaStore.filter.states
}))

const filterSelects = computed(() => [
  { key: 'scentType', label: '香型', options: SCENT_TYPES.map((item) => ({ label: item, value: item })) },
  { key: 'usage', label: '用途', options: USAGE_SCENES.map((item) => ({ label: item, value: item })) },
  { key: 'state', label: '状态', options: FORMULA_STATES.map((item) => ({ label: item, value: item })) }
])

/** 筛选条件 → URL query，刷新与分享后保持视图一致 */
function pushQuery(): void {
  const query: Record<string, string> = {}
  const { keyword, scentTypes, usages, states } = formulaStore.filter
  if (keyword.trim()) query.kw = keyword.trim()
  if (scentTypes.length) query.scent = scentTypes.join(',')
  if (usages.length) query.usage = usages.join(',')
  if (states.length) query.state = states.join(',')
  void router.replace({ query })
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.length > 0) return value.split(',').filter((item) => item.length > 0)
  return []
}

function readQuery(): void {
  const query = route.query
  formulaStore.patchFilter({
    keyword: typeof query.kw === 'string' ? query.kw : '',
    scentTypes: toArray(query.scent).filter((item): item is ScentType => (SCENT_TYPES as string[]).includes(item)),
    usages: toArray(query.usage).filter((item): item is UsageScene => (USAGE_SCENES as string[]).includes(item)),
    states: toArray(query.state).filter((item): item is FormulaState => (FORMULA_STATES as string[]).includes(item))
  })
}

if (Object.keys(route.query).length > 0) readQuery()

watch(
  () => route.query,
  (query) => {
    if (Object.keys(query).length === 0 && formulaStore.hasFilter) {
      formulaStore.resetFilter()
      return
    }
    readQuery()
  }
)

watch(
  () => proportionStore.materialCountMap,
  (map) => formulaStore.setMaterialCountMap(map),
  { immediate: true, deep: true }
)

const cards = computed<FormulaCard[]>(() => formulaStore.filteredCards)

function handleFilterChange(value: FilterModel): void {
  formulaStore.patchFilter({
    keyword: value.keyword,
    scentTypes: Array.isArray(value.scentType) ? (value.scentType as ScentType[]) : [],
    usages: Array.isArray(value.usage) ? (value.usage as UsageScene[]) : [],
    states: Array.isArray(value.state) ? (value.state as FormulaState[]) : []
  })
  pushQuery()
}

function handleReset(): void {
  formulaStore.resetFilter()
  pushQuery()
}

function openCreate(): void {
  editingId.value = null
  form.name = ''
  form.scentType = '线香'
  form.usage = '静室'
  form.state = '草稿'
  form.createdAt = new Date().toISOString().slice(0, 10)
  dialogVisible.value = true
}

function openEdit(formula: Formula): void {
  editingId.value = formula.id
  form.name = formula.name
  form.scentType = formula.scentType
  form.usage = formula.usage
  form.state = formula.state
  form.createdAt = formula.createdAt
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      await formulaStore.updateFormula(editingId.value, {
        name: form.name.trim(),
        scentType: form.scentType,
        usage: form.usage,
        state: form.state,
        createdAt: form.createdAt
      })
      ElMessage.success('香方已更新')
    } else {
      const formula = await formulaStore.createFormula({
        name: form.name,
        scentType: form.scentType,
        usage: form.usage,
        createdAt: form.createdAt,
        state: form.state
      })
      ElMessage.success(`已新建香方「${formula.name}」，请继续录入君臣佐使配比`)
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function advanceState(formula: Formula): Promise<void> {
  const next = await formulaStore.advanceState(formula.id)
  if (next) ElMessage.success(`「${formula.name}」状态已流转为「${next}」`)
}

async function setState(formula: Formula, state: FormulaState): Promise<void> {
  if (formula.state === state) return
  await formulaStore.setState(formula.id, state)
  ElMessage.success(`「${formula.name}」已置为「${state}」`)
}

async function removeFormula(formula: Formula): Promise<void> {
  const card = formulaStore.cardMap[formula.id]
  const confirmed = await ElMessageBox.confirm(
    `删除香方「${formula.name}」将同时删除其 ${card?.materialCount ?? 0} 条配比、${
      card?.batchCount ?? 0
    } 个和香批次及关联的窖藏与品香记录，是否继续？`,
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  const result = await formulaStore.removeFormula(formula.id)
  ElMessage.success(
    `已删除香方，连带清除配比 ${result.proportions} 条、批次 ${result.batches} 个、窖藏 ${result.cellars} 条、品香 ${result.tastings} 条`
  )
}

async function duplicateFormula(formula: Formula): Promise<void> {
  const copy = await formulaStore.duplicateFormula(formula.id)
  if (copy) ElMessage.success(`已复制为「${copy.name}」（草稿），可在此基础上改方`)
}

function openProportion(formula: Formula): void {
  formulaStore.setCurrentFormula(formula.id)
  void router.push('/proportions')
}

function openBatch(formula: Formula): void {
  formulaStore.setCurrentFormula(formula.id)
  void router.push('/batches')
}

async function exportOne(formula: Formula): Promise<void> {
  try {
    const { fileName, counts } = await exportFormulaJson(formula.id)
    ElMessage.success(
      `已导出 ${fileName}（配比 ${counts.proportions} 条 / 批次 ${counts.batches} 个 / 窖藏 ${counts.cellars} 条 / 品香 ${counts.tastings} 条）`
    )
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '导出失败')
  }
}

function openImport(): void {
  importText.value = ''
  importFileName.value = ''
  importVisible.value = true
}

async function handleImportFile(file: File): Promise<void> {
  importFileName.value = file.name
  importText.value = await readFileText(file)
}

function onImportFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files && input.files[0]
  if (file) void handleImportFile(file)
}

async function submitImport(): Promise<void> {
  if (importText.value.trim().length === 0) {
    ElMessage.warning('请先选择或粘贴香方 JSON 内容')
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(importText.value)
  } catch {
    ElMessage.error('JSON 解析失败：文件内容不是合法 JSON')
    return
  }
  const result = validateFormulaJson(parsed)
  if (!result.ok || !result.payload) {
    ElMessage.error(`导入校验未通过：${result.errors.slice(0, 3).join('；')}`)
    return
  }
  const { formulaId, counts } = await importFormulaPayload(result.payload)
  importVisible.value = false
  formulaStore.setCurrentFormula(formulaId)
  ElMessage.success(
    `已导入香方「${result.payload.formula.name}」，新增配比 ${counts.proportions} 条、批次 ${counts.batches} 个`
  )
}

async function reseed(): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    '重置会清空本地全部档案并重新写入演示数据，是否继续？',
    '重置本地数据',
    { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await resetDatabase()
  ElMessage.success('已重置为演示档案')
}

const ratioText = (card: FormulaCard): string => `${round(card.formula.totalRatio, 2)}%`
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>香方台账</h2>
        <p>
          共 {{ formulaStore.formulas.length }} 款香方 · 在用 {{ formulaStore.inUseCount }} 款 · 配比平衡
          {{ formulaStore.balancedCount }} 款 · 品香均分 {{ formulaStore.averageScoreAll || '—' }}
        </p>
      </div>
      <div class="page-title__actions">
        <el-button :icon="Upload" @click="openImport">导入香方 JSON</el-button>
        <el-button :icon="Refresh" @click="reseed">重置演示数据</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建香方</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="香方总数" :value="formulaStore.formulas.length" suffix="款" icon="Files" tone="primary" />
      <StatBadge label="在用香方" :value="formulaStore.inUseCount" suffix="款" icon="Histogram" tone="success" />
      <StatBadge
        label="草稿"
        :value="formulaStore.stateCounts['草稿']"
        suffix="款"
        icon="DataLine"
        tone="warning"
      />
      <StatBadge label="停用" :value="formulaStore.stateCounts['停用']" suffix="款" icon="WarningFilled" tone="danger" />
      <StatBadge
        label="配比平衡率"
        :value="formulaStore.formulas.length === 0 ? 0 : Math.round((formulaStore.balancedCount / formulaStore.formulas.length) * 100)"
        suffix="%"
        icon="TrendCharts"
        tone="info"
        show-percent
        :percent="formulaStore.formulas.length === 0 ? 0 : Math.round((formulaStore.balancedCount / formulaStore.formulas.length) * 100)"
      />
      <StatBadge label="品香均分" :value="formulaStore.averageScoreAll || '—'" icon="PieChart" tone="success" hint="全部批次品香评鉴的烟气评分均分" />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="按香方名 / 香型 / 用途搜索"
      @change="handleFilterChange"
      @reset="handleReset"
    />

    <div v-if="cards.length === 0" class="formula-empty">
      <EmptyPanel
        title="尚未登记香方"
        :description="
          formulaStore.formulas.length === 0
            ? '从一款香方开始：新建香方后可录入香料与君臣佐使配比，再排和香工序与窖藏陈化。'
            : '当前筛选条件下没有匹配的香方，可重置条件或新建一款香方。'
        "
        action-text="新建香方"
        secondary-text="导入香方 JSON"
        :show-seed="formulaStore.formulas.length === 0"
        @action="openCreate"
        @secondary="openImport"
        @seed="reseed"
      />
    </div>

    <div v-else class="formula-grid">
      <article v-for="card in cards" :key="card.formula.id" class="formula-card">
        <header class="formula-card__head">
          <div>
            <h3>{{ card.formula.name }}</h3>
            <p class="muted">
              {{ card.formula.scentType }} · {{ card.formula.usage }} · 创方 {{ card.formula.createdAt }}
            </p>
          </div>
          <el-tag
            :type="card.formula.state === '在用' ? 'success' : card.formula.state === '草稿' ? 'warning' : 'info'"
            effect="plain"
            round
          >
            {{ card.formula.state }}
          </el-tag>
        </header>

        <div class="formula-card__badges">
          <StatBadge label="配比合计" :value="ratioText(card)" size="small" icon="Histogram" :tone="card.ratioGap === 0 ? 'success' : 'danger'" />
          <StatBadge label="香料数" :value="card.materialCount" suffix="味" size="small" icon="Files" tone="info" />
          <StatBadge label="和香批次" :value="card.batchCount" suffix="个" size="small" icon="DataLine" tone="primary" />
          <StatBadge
            label="品香均分"
            :value="card.averageScore === null ? '—' : card.averageScore"
            size="small"
            icon="TrendCharts"
            tone="warning"
          />
        </div>

        <div class="formula-card__tags">
          <GradeTag v-if="card.latestScore !== null" :score="card.latestScore" label="最近品香" size="small" plain />
          <GradeTag v-else label="尚无品香" size="small" plain />
          <span v-if="card.ratioGap !== 0" class="ratio-error">
            配比偏差 {{ card.ratioGap > 0 ? '+' : '' }}{{ card.ratioGap }}%
          </span>
          <span v-else class="ratio-ok">配比刚好 100%</span>
        </div>

        <footer class="formula-card__actions">
          <el-button size="small" type="primary" plain :icon="Histogram" @click="openProportion(card.formula)">
            配比编排
          </el-button>
          <el-button size="small" @click="openBatch(card.formula)">和香批次</el-button>
          <el-button size="small" :icon="Edit" @click="openEdit(card.formula)">编辑</el-button>
          <el-button size="small" :icon="Download" @click="exportOne(card.formula)">导出</el-button>
          <el-button size="small" @click="duplicateFormula(card.formula)">复制</el-button>
          <el-dropdown trigger="click" @command="(command: string) => setState(card.formula, command as FormulaState)">
            <el-button size="small">状态</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="state in FORMULA_STATES" :key="state" :command="state">
                  {{ state }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button size="small" type="warning" plain @click="advanceState(card.formula)">流转状态</el-button>
          <el-button size="small" type="danger" text @click="removeFormula(card.formula)">删除</el-button>
        </footer>
      </article>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑香方' : '新建香方'"
      width="560px"
      append-to-body
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="香方名" prop="name">
          <el-input v-model="form.name" placeholder="如：静室安神线香" maxlength="30" show-word-limit />
        </el-form-item>
        <el-form-item label="创方日期" prop="createdAt">
          <el-date-picker
            v-model="form.createdAt"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择创方日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="香型" prop="scentType">
          <el-radio-group v-model="form.scentType">
            <el-radio v-for="item in SCENT_TYPES" :key="item" :value="item">{{ item }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="用途" prop="usage">
          <el-radio-group v-model="form.usage">
            <el-radio v-for="item in USAGE_SCENES" :key="item" :value="item">{{ item }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="状态" prop="state">
          <el-select v-model="form.state" style="width: 100%">
            <el-option v-for="item in FORMULA_STATES" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ editingId ? '保存修改' : '保存并录入配比' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importVisible" title="导入香方 JSON" width="620px" append-to-body>
      <el-form label-width="96px">
        <el-form-item label="选择文件">
          <input class="import-file" type="file" accept="application/json,.json" @change="onImportFileChange" />
          <span v-if="importFileName" class="muted">{{ importFileName }}</span>
        </el-form-item>
        <el-form-item label="JSON 内容">
          <el-input v-model="importText" type="textarea" :rows="10" placeholder="粘贴由「导出」生成的香方 JSON" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" @click="submitImport">校验并导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.formula-empty {
  margin-top: 16px;
}

.formula-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(390px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.formula-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(74, 53, 36, 0.05);
}

.formula-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.formula-card__head h3 {
  margin: 0;
  font-size: 17px;
}

.formula-card__head p {
  margin: 2px 0 0;
  font-size: 12px;
}

.formula-card__badges {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.formula-card__tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.formula-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}

.import-file {
  font-size: 13px;
}
</style>

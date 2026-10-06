<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Delete, Download, Edit, Plus, Refresh, Upload } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import GradeTag from '@/components/common/GradeTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useFormulaStore } from '@/stores/formulaStore'
import { useIdbTable } from '@/hooks/useIdbTable'
import { DB_VERSION, readLastBackupAt, resetDatabase } from '@/utils/db'
import {
  exportSnapshotJson,
  importSnapshotPayload,
  readFileText,
  validateSnapshotJson
} from '@/utils/export'
import { round } from '@/utils/ratio'
import type { Batch } from '@/types/batch'
import {
  SCORE_BAND_LABEL,
  createEmptyTastingFilter,
  scoreBand,
  type ScoreAggregate,
  type ScoreBand,
  type Tasting,
  type TastingFilterState,
  type TastingRow
} from '@/types/tasting'

const route = useRoute()
const router = useRouter()
const formulaStore = useFormulaStore()
const tastingTable = useIdbTable<Tasting>((database) => database.tastings)
const batchTable = useIdbTable<Batch>((database) => database.batches, { sortByUpdatedAt: false })

const filter = ref<TastingFilterState>(createEmptyTastingFilter())
const dialogVisible = ref(false)
const importVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const importText = ref('')
const importFileName = ref('')
const importOverwrite = ref(false)

const form = reactive<{
  batchId: string
  tastedAt: string
  aroma: string
  lastingMin: number
  smokeScore: number
  comment: string
}>({
  batchId: '',
  tastedAt: new Date().toISOString().slice(0, 10),
  aroma: '',
  lastingMin: 30,
  smokeScore: 8,
  comment: ''
})

const rules: FormRules = {
  batchId: [{ required: true, message: '请选择品鉴的和香批次', trigger: 'change' }],
  tastedAt: [{ required: true, message: '请选择品鉴日期', trigger: 'change' }],
  aroma: [
    { required: true, message: '请填写香韵描述', trigger: 'blur' },
    { min: 2, max: 60, message: '香韵描述 2 ~ 60 字', trigger: 'blur' }
  ],
  lastingMin: [
    { required: true, message: '请填写留香分钟', trigger: 'blur' },
    {
      validator: (_rule, value: number, callback: (error?: Error) => void) => {
        if (!Number.isFinite(value) || value < 0 || value > 600) callback(new Error('留香应在 0 ~ 600 分钟'))
        else callback()
      },
      trigger: 'blur'
    }
  ],
  smokeScore: [
    { required: true, message: '请填写烟气评分', trigger: 'change' },
    {
      validator: (_rule, value: number, callback: (error?: Error) => void) => {
        if (!Number.isFinite(value) || value < 1 || value > 10) callback(new Error('烟气评分应在 1 ~ 10 之间'))
        else callback()
      },
      trigger: 'change'
    }
  ]
}

const batchOptions = computed(() =>
  batchTable.rows.value.map((batch) => {
    const formula = formulaStore.formulaById(batch.formulaId)
    return {
      label: `${formula?.name ?? '香方已删除'} · ${batch.mixedAt} · ${batch.formingMethod}`,
      value: batch.id
    }
  })
)

const filterModel = computed<FilterModel>(() => ({
  keyword: filter.value.keyword,
  formula: filter.value.formulas,
  band: filter.value.bands
}))

const BAND_OPTIONS: Array<{ label: string; value: ScoreBand }> = (
  ['excellent', 'good', 'fair', 'poor'] as ScoreBand[]
).map((band) => ({ label: SCORE_BAND_LABEL[band], value: band }))

const filterSelects = computed(() => [
  {
    key: 'formula',
    label: '香方',
    options: formulaStore.formulas.map((formula) => ({ label: formula.name, value: formula.id }))
  },
  { key: 'band', label: '评分档位', options: BAND_OPTIONS }
])

const queryReady = ref(false)

function pushQuery(): void {
  const query: Record<string, string> = {}
  if (filter.value.keyword.trim()) query.kw = filter.value.keyword.trim()
  if (filter.value.formulas.length) query.formula = filter.value.formulas.join(',')
  if (filter.value.bands.length) query.band = filter.value.bands.join(',')
  if (form.batchId && dialogVisible.value) query.batch = form.batchId
  void router.replace({ query })
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string' && value.length > 0) return value.split(',').filter((item) => item.length > 0)
  return []
}

function readQuery(): void {
  const query = route.query
  filter.value = {
    keyword: typeof query.kw === 'string' ? query.kw : '',
    formulas: toArray(query.formula),
    bands: toArray(query.band).filter((item): item is ScoreBand =>
      (['excellent', 'good', 'fair', 'poor'] as string[]).includes(item)
    )
  }
}

if (Object.keys(route.query).length > 0) readQuery()
queryReady.value = true

watch(
  () => route.query,
  (query) => {
    if (Object.keys(query).length === 0 && hasFilter.value) {
      filter.value = createEmptyTastingFilter()
      return
    }
    readQuery()
  }
)

const hasFilter = computed(
  () => filter.value.keyword.trim().length > 0 || filter.value.formulas.length > 0 || filter.value.bands.length > 0
)

const batchMap = computed<Record<string, Batch>>(() => {
  const map: Record<string, Batch> = {}
  batchTable.rows.value.forEach((batch) => {
    map[batch.id] = batch
  })
  return map
})

const rows = computed<TastingRow[]>(() =>
  tastingTable.rows.value.map((tasting) => {
    const batch = batchMap.value[tasting.batchId]
    return {
      tasting,
      batchLabel: batch ? `${batch.mixedAt} · ${batch.formingMethod} · ${batch.quantity} 支` : '批次已删除',
      formulaId: batch?.formulaId ?? null,
      formulaName: batch ? formulaStore.formulaName(batch.formulaId) : '香方已删除',
      formingMethod: batch?.formingMethod ?? '—'
    }
  })
)

const filteredRows = computed<TastingRow[]>(() =>
  rows.value.filter((row) => {
    const keyword = filter.value.keyword.trim()
    if (keyword.length > 0) {
      const haystack = `${row.formulaName}${row.tasting.aroma}${row.tasting.comment}${row.tasting.tastedAt}`
      if (!haystack.includes(keyword)) return false
    }
    if (filter.value.formulas.length > 0 && (!row.formulaId || !filter.value.formulas.includes(row.formulaId)))
      return false
    if (filter.value.bands.length > 0 && !filter.value.bands.includes(scoreBand(row.tasting.smokeScore))) return false
    return true
  })
)

/** 按香方聚合：同批次多次评鉴取均分并回写香方列表 */
const aggregates = computed<ScoreAggregate[]>(() => {
  const grouped = new Map<string, Tasting[]>()
  rows.value.forEach((row) => {
    if (!row.formulaId) return
    const list = grouped.get(row.formulaId) ?? []
    list.push(row.tasting)
    grouped.set(row.formulaId, list)
  })
  return Array.from(grouped.entries()).map(([formulaId, list]) => ({
    formulaId,
    count: list.length,
    average: round(list.reduce((sum, item) => sum + item.smokeScore, 0) / list.length, 1),
    latestAt: [...list].sort((a, b) => b.tastedAt.localeCompare(a.tastedAt))[0]?.tastedAt ?? ''
  }))
})

const filteredAverage = computed(() => {
  if (filteredRows.value.length === 0) return 0
  return round(
    filteredRows.value.reduce((sum, row) => sum + row.tasting.smokeScore, 0) / filteredRows.value.length,
    1
  )
})

const averageLasting = computed(() => {
  if (filteredRows.value.length === 0) return 0
  return Math.round(filteredRows.value.reduce((sum, row) => sum + row.tasting.lastingMin, 0) / filteredRows.value.length)
})

const excellentCount = computed(() => rows.value.filter((row) => scoreBand(row.tasting.smokeScore) === 'excellent').length)
const lastBackupAt = computed(() => readLastBackupAt())

const countMap = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  rows.value.forEach((row) => {
    if (!row.formulaId) return
    map[row.formulaId] = (map[row.formulaId] ?? 0) + 1
  })
  return map
})

function handleFilterChange(value: FilterModel): void {
  filter.value = {
    keyword: value.keyword,
    formulas: Array.isArray(value.formula) ? (value.formula as string[]) : [],
    bands: Array.isArray(value.band) ? (value.band as ScoreBand[]) : []
  }
  pushQuery()
}

function handleReset(): void {
  filter.value = createEmptyTastingFilter()
  pushQuery()
}

function openCreate(): void {
  editingId.value = null
  const preferred =
    typeof route.query.batch === 'string' && route.query.batch.length > 0
      ? route.query.batch
      : batchTable.rows.value[0]?.id ?? ''
  form.batchId = preferred
  form.tastedAt = new Date().toISOString().slice(0, 10)
  form.aroma = ''
  form.lastingMin = 30
  form.smokeScore = 8
  form.comment = ''
  dialogVisible.value = true
}

function openEdit(tasting: Tasting): void {
  editingId.value = tasting.id
  form.batchId = tasting.batchId
  form.tastedAt = tasting.tastedAt
  form.aroma = tasting.aroma
  form.lastingMin = tasting.lastingMin
  form.smokeScore = tasting.smokeScore
  form.comment = tasting.comment
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      await tastingTable.update(editingId.value, {
        batchId: form.batchId,
        tastedAt: form.tastedAt,
        aroma: form.aroma.trim(),
        lastingMin: form.lastingMin,
        smokeScore: form.smokeScore,
        comment: form.comment.trim()
      })
      ElMessage.success('品香记录已更新，均分已同步到香方台账')
    } else {
      await tastingTable.create(
        {
          batchId: form.batchId,
          tastedAt: form.tastedAt,
          aroma: form.aroma.trim(),
          lastingMin: form.lastingMin,
          smokeScore: form.smokeScore,
          comment: form.comment.trim()
        },
        'tasting'
      )
      const batch = batchMap.value[form.batchId]
      const name = batch ? formulaStore.formulaName(batch.formulaId) : '该香方'
      ElMessage.success(`已记录「${name}」的品香评鉴，同批次均分已回写香方列表`)
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function removeTasting(row: TastingRow): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `删除「${row.formulaName} · ${row.tasting.tastedAt}」这条品香评鉴？删除后香方均分会重新计算。`,
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await tastingTable.remove(row.tasting.id)
  ElMessage.success('品香记录已删除，香方均分已重新计算')
}

async function exportSnapshot(): Promise<void> {
  const { fileName, counts } = await exportSnapshotJson()
  ElMessage.success(
    `已导出 ${fileName}（香方 ${counts.formulas} / 香料 ${counts.materials} / 配比 ${counts.proportions} / 批次 ${counts.batches} / 窖藏 ${counts.cellars} / 品香 ${counts.tastings}）`
  )
}

function openImport(): void {
  importText.value = ''
  importFileName.value = ''
  importOverwrite.value = false
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
    ElMessage.warning('请先选择或粘贴快照 JSON 内容')
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(importText.value)
  } catch {
    ElMessage.error('JSON 解析失败：文件内容不是合法 JSON')
    return
  }
  const result = validateSnapshotJson(parsed)
  if (!result.ok || !result.payload) {
    ElMessage.error(`导入校验未通过：${result.errors.slice(0, 3).join('；')}`)
    return
  }
  const counts = await importSnapshotPayload(result.payload, importOverwrite.value)
  importVisible.value = false
  ElMessage.success(
    `已导入快照（香方 ${counts.formulas} / 香料 ${counts.materials} / 配比 ${counts.proportions} / 批次 ${counts.batches}）`
  )
}

async function reseed(): Promise<void> {
  const confirmed = await ElMessageBox.confirm('重置会清空本地全部档案并重新写入演示数据，是否继续？', '重置本地数据', {
    type: 'warning',
    confirmButtonText: '重置',
    cancelButtonText: '取消'
  }).catch(() => false)
  if (!confirmed) return
  await resetDatabase()
  ElMessage.success('已重置为演示档案')
}

function formulaAverage(formulaId: string): number | null {
  const aggregate = aggregates.value.find((item) => item.formulaId === formulaId)
  return aggregate ? aggregate.average : null
}

function onlyFormula(formulaId: string): void {
  filter.value = { ...filter.value, formulas: [formulaId] }
  pushQuery()
}
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>品香评鉴与香方导出</h2>
        <p>
          共 {{ rows.length }} 条评鉴 · 上品 {{ excellentCount }} 条 · 筛选均分 {{ filteredAverage || '—' }} ·
          本地结构版本 v{{ DB_VERSION }}
        </p>
      </div>
      <div class="page-title__actions">
        <el-button :icon="Upload" @click="openImport">导入 JSON</el-button>
        <el-button :icon="Download" @click="exportSnapshot">导出全量 JSON</el-button>
        <el-button :icon="Refresh" @click="reseed">重置演示数据</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">录入品香</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="品鉴记录" :value="rows.length" suffix="条" icon="Histogram" tone="primary" />
      <StatBadge label="平均烟气分" :value="filteredAverage || '—'" icon="TrendCharts" tone="success" hint="当前筛选结果的均分" />
      <StatBadge label="平均留香" :value="averageLasting" suffix="分钟" icon="PieChart" tone="info" />
      <StatBadge label="上品（9-10）" :value="excellentCount" suffix="条" icon="Files" tone="warning" />
      <StatBadge label="受评香方" :value="aggregates.length" suffix="款" icon="DataLine" tone="default" />
      <StatBadge label="结构版本" :value="`v${DB_VERSION}`" icon="Coin" tone="primary" :hint="lastBackupAt ? `上次导出：${lastBackupAt}` : '尚未导出过备份'" />
    </div>

    <div class="section-card">
      <div class="section-card__head">
        <h3>香方品香均分（同批次多次评鉴取均分回写香方列表）</h3>
        <span class="muted">导出文件包含香方、香料、配比、批次、窖藏与品香全部数据</span>
      </div>
      <div v-if="aggregates.length === 0" class="muted">暂无品香评鉴数据，录入第一条后这里会显示均分。</div>
      <el-table v-else :data="aggregates" size="small" row-key="formulaId">
        <el-table-column label="香方" min-width="180">
          <template #default="{ row }: { row: ScoreAggregate }">
            <span class="cell-main">{{ formulaStore.formulaName(row.formulaId) }}</span>
            <span class="cell-sub muted"> · 最近 {{ row.latestAt }}</span>
          </template>
        </el-table-column>
        <el-table-column label="评鉴次数" width="110">
          <template #default="{ row }: { row: ScoreAggregate }">
            <span class="mono">{{ row.count }}</span>
          </template>
        </el-table-column>
        <el-table-column label="均分档位" width="150">
          <template #default="{ row }: { row: ScoreAggregate }">
            <GradeTag :score="row.average" :label="SCORE_BAND_LABEL[scoreBand(row.average)]" plain size="small" />
          </template>
        </el-table-column>
        <el-table-column label="香方台账回写值" min-width="180">
          <template #default="{ row }: { row: ScoreAggregate }">
            <span class="mono">{{ formulaAverage(row.formulaId) ?? '—' }}</span>
            <span class="cell-sub muted"> · 批次 {{ formulaStore.cardMap[row.formulaId]?.batchCount ?? 0 }} 个</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }: { row: ScoreAggregate }">
            <el-button size="small" text type="primary" @click="onlyFormula(row.formulaId)">只看该香方</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="按香方名 / 香韵 / 评语搜索"
      @change="handleFilterChange"
      @reset="handleReset"
    />

    <div class="section-card tasting-table">
      <div v-if="filteredRows.length === 0" class="tasting-empty">
        <EmptyPanel
          title="暂无品香评鉴"
          :description="
            rows.length === 0
              ? '出窖后取一炉试香：记录香韵、留香时长与烟气评分，均分会自动回写到香方台账。'
              : '当前筛选条件下没有匹配的品香记录，可重置条件或录入新评鉴。'
          "
          action-text="录入品香"
          secondary-text="导出全量 JSON"
          @action="openCreate"
          @secondary="exportSnapshot"
        />
      </div>

      <el-table v-else :data="filteredRows" row-key="tasting.id" stripe>
        <el-table-column label="香方 / 批次" min-width="200">
          <template #default="{ row }: { row: TastingRow }">
            <div class="cell-main">{{ row.formulaName }}</div>
            <div class="cell-sub muted">{{ row.batchLabel }}</div>
          </template>
        </el-table-column>
        <el-table-column label="品鉴日期" prop="tasting.tastedAt" width="120" />
        <el-table-column label="香韵" min-width="200">
          <template #default="{ row }: { row: TastingRow }">
            <div class="cell-sub">{{ row.tasting.aroma }}</div>
            <div class="cell-sub muted">{{ row.tasting.comment || '无评语' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="留香" width="100">
          <template #default="{ row }: { row: TastingRow }">
            <span class="mono">{{ row.tasting.lastingMin }}</span> 分钟
          </template>
        </el-table-column>
        <el-table-column label="烟气评分" width="150">
          <template #default="{ row }: { row: TastingRow }">
            <GradeTag :score="row.tasting.smokeScore" plain size="small" />
          </template>
        </el-table-column>
        <el-table-column label="同方均分" width="120">
          <template #default="{ row }: { row: TastingRow }">
            <span class="mono">{{ row.formulaId ? formulaAverage(row.formulaId) ?? '—' : '—' }}</span>
            <span class="cell-sub muted"> · {{ row.formulaId ? countMap[row.formulaId] ?? 0 : 0 }} 次</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }: { row: TastingRow }">
            <el-button size="small" text type="primary" :icon="Edit" @click="openEdit(row.tasting)">编辑</el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="removeTasting(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑品香评鉴' : '录入品香评鉴'" width="580px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="104px">
        <el-form-item label="和香批次" prop="batchId">
          <el-select v-model="form.batchId" filterable placeholder="选择批次" style="width: 100%">
            <el-option v-for="item in batchOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="品鉴日期" prop="tastedAt">
          <el-date-picker
            v-model="form.tastedAt"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            placeholder="选择品鉴日期"
          />
        </el-form-item>
        <el-form-item label="香韵" prop="aroma">
          <el-input
            v-model="form.aroma"
            type="textarea"
            :rows="3"
            maxlength="60"
            show-word-limit
            placeholder="如：初闻清甜，中段檀香渐起，尾调沉静"
          />
        </el-form-item>
        <el-form-item label="留香分钟" prop="lastingMin">
          <el-input-number v-model="form.lastingMin" :min="0" :max="600" :step="5" style="width: 180px" />
        </el-form-item>
        <el-form-item label="烟气评分" prop="smokeScore">
          <el-slider v-model="form.smokeScore" :min="1" :max="10" :step="1" show-stops style="width: 320px" />
          <GradeTag class="score-preview" :score="form.smokeScore" plain size="small" />
        </el-form-item>
        <el-form-item label="评语" prop="comment">
          <el-input v-model="form.comment" type="textarea" :rows="3" maxlength="80" show-word-limit placeholder="如：烟气柔和，静室午后一炷最宜" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ editingId ? '保存修改' : '保存并计算均分' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importVisible" title="导入 JSON 快照" width="620px" append-to-body>
      <el-form label-width="104px">
        <el-form-item label="选择文件">
          <input class="import-file" type="file" accept="application/json,.json" @change="onImportFileChange" />
          <span v-if="importFileName" class="muted">{{ importFileName }}</span>
        </el-form-item>
        <el-form-item label="覆盖导入">
          <el-switch v-model="importOverwrite" active-text="清空现有数据后导入" />
        </el-form-item>
        <el-form-item label="JSON 内容">
          <el-input v-model="importText" type="textarea" :rows="10" placeholder="粘贴由「导出全量 JSON」生成的文件内容" />
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
.tasting-table {
  margin-top: 16px;
}

.tasting-empty {
  padding: 8px 0;
}

.cell-main {
  font-weight: 600;
}

.cell-sub {
  font-size: 12px;
  line-height: 1.6;
}

.score-preview {
  margin-left: 12px;
}

.import-file {
  font-size: 13px;
}
</style>

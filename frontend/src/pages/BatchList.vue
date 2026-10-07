<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Delete, Document, Edit, Histogram, Plus } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useFormulaStore } from '@/stores/formulaStore'
import { useMaterialStore } from '@/stores/materialStore'
import { useProportionStore } from '@/stores/proportionStore'
import { useCellarStore } from '@/stores/cellarStore'
import { useIdbTable } from '@/hooks/useIdbTable'
import { useProportion } from '@/hooks/useProportion'
import { db } from '@/utils/db'
import { round } from '@/utils/ratio'
import { buildSnapshotItems } from '@/utils/master'
import {
  FORMING_METHODS,
  createEmptyBatchFilter,
  type Batch,
  type BatchFilterState,
  type BatchRow,
  type BatchSnapshotItem,
  type FormingMethod
} from '@/types/batch'
import type { Material } from '@/types/material'

const route = useRoute()
const router = useRouter()
const formulaStore = useFormulaStore()
const materialStore = useMaterialStore()
const proportionStore = useProportionStore()
const cellarStore = useCellarStore()
const batchTable = useIdbTable<Batch>((database) => database.batches)
/** 用 useProportion 校验和香前的配比合计，避免用未平衡的方子开批次 */
const { rows: selectedProportionRows, total: selectedRatioTotal, checkLevel, checkMessage } = useProportion()

const filter = ref<BatchFilterState>(createEmptyBatchFilter())
const dialogVisible = ref(false)
const detailVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const detailBatchId = ref<string | null>(null)

const form = reactive<{
  formulaId: string
  mixedAt: string
  formingMethod: FormingMethod
  quantity: number
  operator: string
}>({
  formulaId: '',
  mixedAt: new Date().toISOString().slice(0, 10),
  formingMethod: '挤条',
  quantity: 100,
  operator: ''
})

const rules: FormRules = {
  formulaId: [{ required: true, message: '请选择香方', trigger: 'change' }],
  mixedAt: [{ required: true, message: '请选择和香日期', trigger: 'change' }],
  formingMethod: [{ required: true, message: '请选择成型方式', trigger: 'change' }],
  quantity: [
    { required: true, message: '请填写数量', trigger: 'blur' },
    {
      validator: (_rule, value: number, callback: (error?: Error) => void) => {
        if (!Number.isFinite(value) || value <= 0) callback(new Error('数量需大于 0'))
        else callback()
      },
      trigger: 'blur'
    }
  ],
  operator: [{ required: true, message: '请填写制香人', trigger: 'blur' }]
}

const formulaOptions = computed(() =>
  formulaStore.formulas.map((formula) => ({
    label: `${formula.name}（${formula.scentType} · 配比合计 ${round(formula.totalRatio, 2)}%）`,
    value: formula.id
  }))
)

const filterModel = computed<FilterModel>(() => ({
  keyword: filter.value.keyword,
  formula: filter.value.formulas,
  forming: filter.value.formingMethods
}))

const filterSelects = computed(() => [
  {
    key: 'formula',
    label: '香方',
    options: formulaStore.formulas.map((formula) => ({ label: formula.name, value: formula.id }))
  },
  { key: 'forming', label: '成型方式', options: FORMING_METHODS.map((item) => ({ label: item, value: item })) }
])

function pushQuery(): void {
  const query: Record<string, string> = {}
  if (filter.value.keyword.trim()) query.kw = filter.value.keyword.trim()
  if (filter.value.formulas.length) query.formula = filter.value.formulas.join(',')
  if (filter.value.formingMethods.length) query.forming = filter.value.formingMethods.join(',')
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
    formingMethods: toArray(query.forming).filter((item): item is FormingMethod =>
      (FORMING_METHODS as string[]).includes(item)
    )
  }
}

if (Object.keys(route.query).length > 0) readQuery()

watch(
  () => route.query,
  (query) => {
    if (Object.keys(query).length === 0 && hasFilter.value) {
      filter.value = createEmptyBatchFilter()
      return
    }
    readQuery()
  }
)

const hasFilter = computed(
  () =>
    filter.value.keyword.trim().length > 0 ||
    filter.value.formulas.length > 0 ||
    filter.value.formingMethods.length > 0
)

const rows = computed<BatchRow[]>(() => {
  const materialRevMap = new Map<string, number>(
    materialStore.materials.map((material) => [material.id, material.rev])
  )
  return batchTable.rows.value.map((batch) => {
    const currentRatioTotal = proportionStore.totalByFormula[batch.formulaId] ?? 0
    const snapshotRatioTotal = round(
      batch.snapshot.reduce((sum, item) => sum + item.ratio, 0),
      2
    )
    const cellars = cellarStore.cellarsOfBatch(batch.id)
    const snapshotLocked = cellars.length > 0
    // 未入窖批次快照随主档联动重算，若仍有条目落后于主档修订号则提示需重算
    const staleSnapshotCount = snapshotLocked
      ? 0
      : batch.snapshot.filter((item) => {
          const latest = materialRevMap.get(item.materialId)
          return typeof latest === 'number' && item.materialRev !== latest
        }).length
    return {
      batch,
      formulaName: formulaStore.formulaName(batch.formulaId),
      snapshotCount: batch.snapshot.length,
      currentRatioTotal,
      snapshotRatioTotal,
      cellared: cellars.length > 0,
      cellarState: cellars.length === 0 ? '未入窖' : cellars.map((cellar) => cellar.state).join(' / '),
      snapshotLocked,
      staleSnapshotCount
    }
  })
})

const filteredRows = computed<BatchRow[]>(() =>
  rows.value.filter((row) => {
    const keyword = filter.value.keyword.trim()
    if (keyword.length > 0) {
      const haystack = `${row.formulaName}${row.batch.formingMethod}${row.batch.operator}${row.batch.mixedAt}`
      if (!haystack.includes(keyword)) return false
    }
    if (filter.value.formulas.length > 0 && !filter.value.formulas.includes(row.batch.formulaId)) return false
    if (filter.value.formingMethods.length > 0 && !filter.value.formingMethods.includes(row.batch.formingMethod))
      return false
    return true
  })
)

const totalQuantity = computed(() => filteredRows.value.reduce((sum, row) => sum + row.batch.quantity, 0))
const cellaredCount = computed(() => rows.value.filter((row) => row.cellared).length)
const driftedCount = computed(() =>
  rows.value.filter((row) => Math.abs(row.currentRatioTotal - row.snapshotRatioTotal) > 0.01).length
)
const staleCount = computed(() => rows.value.filter((row) => row.staleSnapshotCount > 0).length)
const lockedCount = computed(() => rows.value.filter((row) => row.snapshotLocked).length)
const averageQuantity = computed(() =>
  rows.value.length === 0 ? 0 : Math.round(rows.value.reduce((sum, row) => sum + row.batch.quantity, 0) / rows.value.length)
)

const detailRow = computed<BatchRow | null>(() => rows.value.find((row) => row.batch.id === detailBatchId.value) ?? null)

/** 香方 id → 配比味数，用于快照对照时回显 */
const proportionCountMap = computed<Record<string, number>>(() => proportionStore.materialCountMap)

/** 对照快照与当前方子：返回差异说明文案（占比 + 等级/炮制写法） */
function snapshotDiff(item: BatchSnapshotItem, row: BatchRow): string {
  const currentItem = proportionStore
    .proportionsByFormula(row.batch.formulaId)
    .find((proportion) => proportion.materialId === item.materialId)
  if (!currentItem) return '已从方中移除'
  const delta = round(currentItem.ratio - item.ratio, 2)
  const material = materialStore.materialById(item.materialId)
  const writingDrift =
    material && (material.grade !== item.grade || material.processMethod !== item.processMethod)
  if (delta === 0 && !writingDrift) return '与当前一致'
  const parts: string[] = []
  if (delta !== 0) parts.push(`占比当前 ${currentItem.ratio}%（${delta > 0 ? '+' : ''}${delta}%）`)
  if (writingDrift && material) parts.push(`写法 ${item.grade}·${item.processMethod} → ${material.grade}·${material.processMethod}`)
  return parts.join('；')
}

function handleFilterChange(value: FilterModel): void {
  filter.value = {
    keyword: value.keyword,
    formulas: Array.isArray(value.formula) ? (value.formula as string[]) : [],
    formingMethods: Array.isArray(value.forming) ? (value.forming as FormingMethod[]) : []
  }
  pushQuery()
}

function handleReset(): void {
  filter.value = createEmptyBatchFilter()
  pushQuery()
}

async function buildSnapshot(formulaId: string): Promise<BatchSnapshotItem[]> {
  return buildSnapshotItems(formulaId)
}

function openCreate(): void {
  editingId.value = null
  form.formulaId = formulaStore.currentFormulaId ?? formulaStore.formulas[0]?.id ?? ''
  form.mixedAt = new Date().toISOString().slice(0, 10)
  form.formingMethod = '挤条'
  form.quantity = 100
  form.operator = ''
  dialogVisible.value = true
}

function openEdit(batch: Batch): void {
  editingId.value = batch.id
  form.formulaId = batch.formulaId
  form.mixedAt = batch.mixedAt
  form.formingMethod = batch.formingMethod
  form.quantity = batch.quantity
  form.operator = batch.operator
  dialogVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      await batchTable.update(editingId.value, {
        formulaId: form.formulaId,
        mixedAt: form.mixedAt,
        formingMethod: form.formingMethod,
        quantity: form.quantity,
        operator: form.operator.trim()
      })
      ElMessage.success('批次已更新')
    } else {
      const snapshot = await buildSnapshot(form.formulaId)
      const batch = await batchTable.create(
        {
          formulaId: form.formulaId,
          mixedAt: form.mixedAt,
          formingMethod: form.formingMethod,
          quantity: form.quantity,
          operator: form.operator.trim(),
          snapshot,
          snapshotAt: Date.now()
        },
        'batch'
      )
      ElMessage.success(`已生成批次，自动带出 ${snapshot.length} 条配比快照，便于追溯改方前后差异`)
      detailBatchId.value = batch.id
    }
    dialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

async function removeBatch(row: BatchRow): Promise<void> {
  const cellars = cellarStore.cellarsOfBatch(row.batch.id)
  const confirmed = await ElMessageBox.confirm(
    `删除批次「${row.formulaName} · ${row.batch.mixedAt}」将同时删除其 ${cellars.length} 条窖藏与全部品香记录，是否继续？`,
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  const cellarIds = cellars.map((cellar) => cellar.id)
  const tastingIds = await db.tastings.where('batchId').equals(row.batch.id).primaryKeys()
  await db.transaction('rw', [db.batches, db.cellars, db.tastings], async () => {
    await db.tastings.bulkDelete(tastingIds)
    await db.cellars.bulkDelete(cellarIds)
    await db.batches.delete(row.batch.id)
  })
  ElMessage.success(`已删除批次，连带清除窖藏 ${cellarIds.length} 条、品香 ${tastingIds.length} 条`)
}

async function refreshSnapshot(row: BatchRow): Promise<void> {
  if (row.snapshotLocked) {
    ElMessage.warning('该批次已入窖，快照锁住当时写法，不能再按当前方子重置')
    return
  }
  const snapshot = await buildSnapshot(row.batch.formulaId)
  await batchTable.update(row.batch.id, { snapshot, snapshotAt: Date.now() })
  ElMessage.success('已按当前配比重置快照')
}

/** 快照条目里的等级/炮制在当前主档下的取值，用于详情对照 */
function currentWriting(item: BatchSnapshotItem): Material | undefined {
  return materialStore.materialById(item.materialId)
}

function openDetail(row: BatchRow): void {
  detailBatchId.value = row.batch.id
  detailVisible.value = true
}

function goCellar(row: BatchRow): void {
  cellarStore.patchFilter({ keyword: row.formulaName })
  void router.push('/cellar')
}

function goProportion(row: BatchRow): void {
  formulaStore.setCurrentFormula(row.batch.formulaId)
  void router.push('/proportions')
}
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>和香工序与成型登记</h2>
        <p>
          共 {{ rows.length }} 个批次 · 已入窖 {{ cellaredCount }} 个（快照锁定）· 主档改写待重算 {{ staleCount }} 个 ·
          配比改动 {{ driftedCount }} 个 · 当前筛选 {{ filteredRows.length }} 个
        </p>
      </div>
      <div class="page-title__actions">
        <el-button type="primary" :icon="Plus" @click="openCreate">登记和香批次</el-button>
      </div>
    </div>

    <div class="stat-row">
      <StatBadge label="批次总数" :value="rows.length" suffix="个" icon="Box" tone="primary" />
      <StatBadge label="筛选中数量" :value="totalQuantity" suffix="支/丸" icon="Histogram" tone="info" />
      <StatBadge label="已入窖锁定" :value="lockedCount" suffix="个" icon="Lock" tone="success" />
      <StatBadge label="待按主档重算" :value="staleCount" suffix="个" icon="RefreshRight" tone="warning" hint="未入窖批次快照里有香料等级/炮制落后于主档" />
      <StatBadge label="配比已改动" :value="driftedCount" suffix="个" icon="Document" tone="warning" hint="当前配比合计与批次快照不一致" />
      <StatBadge label="平均产量" :value="averageQuantity" suffix="支/丸" icon="TrendCharts" tone="default" />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="按香方名 / 制香人 / 和香日期搜索"
      @change="handleFilterChange"
      @reset="handleReset"
    />

    <div class="section-card batch-table">
      <div v-if="filteredRows.length === 0" class="batch-empty">
        <EmptyPanel
          title="暂无和香批次"
          :description="
            rows.length === 0
              ? '和香前先在配比页把君臣佐使调到合计 100%，再回到这里登记成型批次与制香人。'
              : '当前筛选条件下没有匹配的批次，可重置条件或登记新批次。'
          "
          action-text="登记和香批次"
          :show-seed="false"
          @action="openCreate"
        />
      </div>

      <el-table v-else :data="filteredRows" row-key="batch.id" stripe>
        <el-table-column label="香方 / 批次号" min-width="200">
          <template #default="{ row }: { row: BatchRow }">
            <div class="cell-main">{{ row.formulaName }}</div>
            <div class="cell-sub muted mono">批次 {{ row.batch.id.slice(-8) }} · 快照 {{ row.snapshotCount }} 味</div>
          </template>
        </el-table-column>
        <el-table-column label="和香日期" prop="batch.mixedAt" width="130" />
        <el-table-column label="成型方式" prop="batch.formingMethod" width="120" />
        <el-table-column label="数量" width="110">
          <template #default="{ row }: { row: BatchRow }">
            <span class="mono">{{ row.batch.quantity }}</span>
          </template>
        </el-table-column>
        <el-table-column label="制香人" prop="batch.operator" width="120" />
        <el-table-column label="配比对照" min-width="190">
          <template #default="{ row }: { row: BatchRow }">
            <div class="cell-sub">
              快照合计 <span class="mono">{{ row.snapshotRatioTotal }}%</span> · 当前合计
              <span class="mono">{{ row.currentRatioTotal }}%</span>
            </div>
            <div class="cell-sub" :class="Math.abs(row.currentRatioTotal - row.snapshotRatioTotal) > 0.01 ? 'ratio-error' : 'ratio-ok'">
              {{ Math.abs(row.currentRatioTotal - row.snapshotRatioTotal) > 0.01 ? '改方后配比已变化' : '配比与快照一致' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="窖藏状态" width="180">
          <template #default="{ row }: { row: BatchRow }">
            <el-tag :type="row.cellared ? 'success' : 'info'" effect="plain" round>{{ row.cellarState }}</el-tag>
            <div v-if="row.snapshotLocked" class="cell-sub muted">入窖锁定当时写法</div>
            <el-tag v-else-if="row.staleSnapshotCount > 0" type="warning" size="small" effect="plain" round>
              {{ row.staleSnapshotCount }} 味待重算
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }: { row: BatchRow }">
            <el-button size="small" text type="primary" :icon="Document" @click="openDetail(row)">快照对照</el-button>
            <el-button size="small" text @click="goCellar(row)">窖藏</el-button>
            <el-button size="small" text :icon="Edit" @click="openEdit(row.batch)">编辑</el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="removeBatch(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑和香批次' : '登记和香批次'" width="580px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="104px">
        <el-form-item label="香方" prop="formulaId">
          <el-select v-model="form.formulaId" filterable placeholder="选择香方" style="width: 100%">
            <el-option v-for="item in formulaOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="和香日期" prop="mixedAt">
          <el-date-picker
            v-model="form.mixedAt"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            placeholder="选择和香日期"
          />
        </el-form-item>
        <el-form-item label="成型方式" prop="formingMethod">
          <el-radio-group v-model="form.formingMethod">
            <el-radio v-for="item in FORMING_METHODS" :key="item" :value="item">{{ item }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="数量" prop="quantity">
          <el-input-number v-model="form.quantity" :min="1" :max="99999" :step="10" style="width: 200px" />
          <span class="muted form-hint">支 / 丸 / 饼</span>
        </el-form-item>
        <el-form-item label="制香人" prop="operator">
          <el-input v-model="form.operator" placeholder="如：林砚舟" maxlength="20" />
        </el-form-item>
        <el-alert
          v-if="form.formulaId"
          class="ratio-alert"
          :type="checkLevel === 'ok' ? 'success' : checkLevel === 'warn' ? 'warning' : 'error'"
          :closable="false"
          show-icon
          :title="`当前方子配比：${selectedRatioTotal}%（${selectedProportionRows.length} 味）`"
          :description="checkMessage"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ editingId ? '保存修改' : '生成批次并固化快照' }}
        </el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" title="配比快照对照" size="520px" append-to-body>
      <template v-if="detailRow">
        <div class="snapshot-head">
          <h3>{{ detailRow.formulaName }}</h3>
          <p class="muted">
            和香 {{ detailRow.batch.mixedAt }} · {{ detailRow.batch.formingMethod }} · {{ detailRow.batch.quantity }} 支 ·
            {{ detailRow.batch.operator }}
          </p>
          <p class="muted">快照固化于 {{ new Date(detailRow.batch.snapshotAt || Date.now()).toLocaleString('zh-CN') }}</p>
          <el-alert
            v-if="detailRow.snapshotLocked"
            class="snapshot-lock"
            type="success"
            :closable="false"
            show-icon
            title="该批次已入窖：快照锁住入窖当时的等级与炮制写法，之后主档再改也不重算"
          />
          <el-alert
            v-else-if="detailRow.staleSnapshotCount > 0"
            class="snapshot-lock"
            type="warning"
            :closable="false"
            show-icon
            title="未入窖快照中有香材写法落后于主档，已随主档联动重算；也可点下方按钮按当前配比整体重置"
          />
        </div>

        <div class="snapshot-badges">
          <StatBadge label="快照合计" :value="detailRow.snapshotRatioTotal" suffix="%" size="small" icon="Histogram" tone="info" />
          <StatBadge label="当前合计" :value="detailRow.currentRatioTotal" suffix="%" size="small" icon="Histogram" tone="primary" />
          <StatBadge
            label="当前味数"
            :value="proportionCountMap[detailRow.batch.formulaId] ?? 0"
            suffix="味"
            size="small"
            icon="Files"
            tone="default"
          />
        </div>

        <el-table :data="detailRow.batch.snapshot" size="small" row-key="materialId">
          <el-table-column label="香料" prop="materialName" min-width="110" />
          <el-table-column label="角色" prop="role" width="60" />
          <el-table-column label="快照写法" min-width="130">
            <template #default="{ row }: { row: BatchSnapshotItem }">
              <div class="cell-sub">{{ row.grade }} · {{ row.processMethod }}</div>
              <div v-if="!detailRow.snapshotLocked && currentWriting(row) && (currentWriting(row)?.grade !== row.grade || currentWriting(row)?.processMethod !== row.processMethod)" class="cell-sub ratio-error">
                主档已改 {{ currentWriting(row)?.grade }} · {{ currentWriting(row)?.processMethod }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="快照占比" width="90">
            <template #default="{ row }: { row: BatchSnapshotItem }">
              <span class="mono">{{ row.ratio }}%</span>
            </template>
          </el-table-column>
          <el-table-column label="与当前对比" min-width="150">
            <template #default="{ row }: { row: BatchSnapshotItem }">
              <span class="cell-sub">{{ snapshotDiff(row, detailRow) }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="snapshot-actions">
          <el-button
            :icon="Document"
            :disabled="detailRow.snapshotLocked"
            :title="detailRow.snapshotLocked ? '已入窖批次快照已锁定' : ''"
            @click="refreshSnapshot(detailRow)"
          >
            按当前配比重置快照
          </el-button>
          <el-button :icon="Histogram" @click="goProportion(detailRow)">去改配比</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.batch-table {
  margin-top: 16px;
}

.batch-empty {
  padding: 8px 0;
}

.cell-main {
  font-weight: 600;
}

.cell-sub {
  font-size: 12px;
  line-height: 1.6;
}

.form-hint {
  margin-left: 10px;
  font-size: 12px;
}

.ratio-alert {
  margin-bottom: 12px;
}

.snapshot-head h3 {
  margin: 0 0 4px;
}

.snapshot-head p {
  margin: 0 0 4px;
  font-size: 12px;
}

.snapshot-badges {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}

.snapshot-lock {
  margin-top: 10px;
}

.snapshot-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>

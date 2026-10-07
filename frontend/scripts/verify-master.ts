// 端到端逻辑验证：v2→v3 回填、主档改动联动、入窖锁定、乐观并发
import 'fake-indexeddb/auto'
import { assert } from 'console'
import Dexie from 'dexie'

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('❌ FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('✅', msg)
  }
}

// ---- 1. 先以 v2 结构造历史数据 ----
class LegacyDb extends Dexie {
  constructor() {
    super('gbincense')
    this.version(1).stores({
      formulas: 'id, name, scentType, usage, state, totalRatio',
      materials: 'id, name, origin, grade, processMethod',
      proportions: 'id, formulaId, materialId, role',
      batches: 'id, formulaId, mixedAt, formingMethod',
      cellars: 'id, batchId, startDate, endDate, state',
      tastings: 'id, batchId, tastedAt, smokeScore'
    })
    this.version(2).stores({
      formulas: 'id, name, scentType, usage, state, createdAt, totalRatio, updatedAt',
      materials: 'id, name, origin, grade, processMethod, updatedAt',
      proportions: 'id, formulaId, materialId, role, seq, updatedAt',
      batches: 'id, formulaId, mixedAt, formingMethod, updatedAt',
      cellars: 'id, batchId, startDate, endDate, state, updatedAt',
      tastings: 'id, batchId, tastedAt, smokeScore, updatedAt'
    })
  }
}
const legacy = new LegacyDb()
// @ts-expect-error 动态表
await legacy.formulas.bulkPut([
  { id: 'f1', name: '安神线香', scentType: '线香', usage: '静室', state: '在用', createdAt: '2024-01-01', totalRatio: 100, updatedAt: 1 },
  { id: 'f2', name: '新配方', scentType: '香丸', usage: '佩香', state: '草稿', createdAt: '2024-02-01', totalRatio: 100, updatedAt: 1 }
])
// @ts-expect-error 动态表
await legacy.materials.bulkPut([
  { id: 'm1', name: '沉香', origin: '海南', grade: '一级', processMethod: '生用', aromaNote: '', createdAt: '2024-01-01', updatedAt: 1 },
  { id: 'm2', name: '檀香', origin: '印度', grade: '二级', processMethod: '炒黄', aromaNote: '', createdAt: '2024-01-01', updatedAt: 1 }
])
// @ts-expect-error 动态表
await legacy.proportions.bulkPut([
  { id: 'p1', formulaId: 'f1', materialId: 'm1', ratio: 60, role: '君', note: '', seq: 1, updatedAt: 1 },
  { id: 'p2', formulaId: 'f1', materialId: 'm2', ratio: 40, role: '臣', note: '', seq: 2, updatedAt: 1 },
  { id: 'p3', formulaId: 'f2', materialId: 'm1', ratio: 100, role: '君', note: '', seq: 1, updatedAt: 1 }
])
// b1 已入窖（有 cellar），b2 未入窖 —— 两者快照都只有旧四字段
// @ts-expect-error 动态表
await legacy.batches.bulkPut([
  { id: 'b1', formulaId: 'f1', mixedAt: '2024-03-01', formingMethod: '挤条', quantity: 100, operator: '甲',
    snapshot: [
      { materialId: 'm1', materialName: '沉香', ratio: 60, role: '君' },
      { materialId: 'm2', materialName: '檀香', ratio: 40, role: '臣' }
    ], snapshotAt: 1709000000000, updatedAt: 1 },
  { id: 'b2', formulaId: 'f2', mixedAt: '2024-05-01', formingMethod: '压模', quantity: 50, operator: '乙',
    snapshot: [{ materialId: 'm1', materialName: '沉香', ratio: 100, role: '君' }], snapshotAt: 1714000000000, updatedAt: 1 }
])
// @ts-expect-error 动态表
await legacy.cellars.put({
  id: 'c1', batchId: 'b1', startDate: '2024-03-05', endDate: '2025-03-05',
  temperatureC: 22, humidityPct: 60, container: '陶罐', state: '窖藏中', updatedAt: 1
})
legacy.close()

// ---- 2. 用真实模块以 v3 打开，触发 upgrade ----
const { db, DB_VERSION } = await import('../src/utils/db.ts')
ok(DB_VERSION === 3, `DB_VERSION = 3（实际 ${DB_VERSION}）`)

const m1After = await db.materials.get('m1')
ok(m1After.revision === 1, '历史香料按当前值回填 revision=1')
const p1After = await db.proportions.get('p1')
ok(p1After.materialRevision === 1, '历史配比回填 materialRevision=1')
const b1After = await db.batches.get('b1')
const b2After = await db.batches.get('b2')
ok(b1After.locked === true && b1After.lockedAt > 0, '已入窖批次 b1 升级后锁定')
ok(b2After.locked === false && b2After.lockedAt === 0, '未入窖批次 b2 未锁定')
ok(b1After.snapshot[0].grade === '一级' && b1After.snapshot[0].processMethod === '生用',
  '锁定批次快照补齐当时等级/炮制写法')
ok(b1After.snapshot[0].materialRevision === 1, '锁定快照条目带修订号')
ok(b2After.snapshot[0].grade === '一级', '未入窖批次按当前主档重算写法')

// ---- 3. 改 m1 的等级 / 炮制 → 主档服务联动 ----
const { applyMaterialUpdate } = await import('../src/utils/masterSync.ts')
const res = await applyMaterialUpdate('m1', { grade: '特级', processMethod: '蜜炙' })
ok(res.writingChanged === true && res.revision === 2, '改写法抬修订号到 2')
ok(res.recalcedBatches === 1, `未入窖批次快照重算 1 个（实际 ${res.recalcedBatches}）`)

const m1v2 = await db.materials.get('m1')
ok(m1v2.revision === 2 && m1v2.grade === '特级', '主档已是特级/蜜炙 v2')
const b1AfterChange = await db.batches.get('b1')
ok(b1AfterChange.snapshot[0].grade === '一级' && b1AfterChange.snapshot[0].processMethod === '生用',
  '已入窖批次 b1 锁住旧写法（一级/生用）不被重算')
ok(b1AfterChange.locked === true, 'b1 仍处于锁定')
const b2AfterChange = await db.batches.get('b2')
ok(b2AfterChange.snapshot[0].grade === '特级' && b2AfterChange.snapshot[0].processMethod === '蜜炙'
  && b2AfterChange.snapshot[0].materialRevision === 2,
  '未入窖批次 b2 快照失效重算为最新主档 v2')

// 改名不抬修订号
const resName = await applyMaterialUpdate('m1', { name: '海南沉香（特级）' })
ok(resName.writingChanged === false && resName.revision === 2, '只改名不抬修订号')

// ---- 4. 乐观并发：基于旧修订号保存配比应冲突，按新号重试成功 ----
const proportionStoreMod = await import('../src/stores/proportionStore.ts')
const { setActivePinia, createPinia } = await import('pinia')
setActivePinia(createPinia())
const store = proportionStoreMod.useProportionStore()
let conflicted = false
try {
  await store.updateProportion('p1', { note: '基于旧主档的草稿' }, 1)
} catch (err) {
  conflicted = (err as { name?: string }).name === 'MasterConflictError'
}
ok(conflicted, '基于旧修订号 v1 保存返回 MasterConflictError，草稿可保留重试')
// 冲突后没写库
const p1Still = await db.proportions.get('p1')
ok(p1Still.note === '', '冲突时未写入（草稿留在表单侧）')
await store.updateProportion('p1', { note: '按最新主档重试' }, 2)
const p1Updated = await db.proportions.get('p1')
ok(p1Updated.note === '按最新主档重试' && p1Updated.materialRevision === 2,
  '带草稿按最新修订号重试成功，并对齐 materialRevision=2')
// 不传修订号的就地编辑（只改占比）直接跟随
await store.updateProportion('p2', { ratio: 41 })
const p2Updated = await db.proportions.get('p2')
ok(p2Updated.ratio === 41 && p2Updated.materialRevision === 1, '就地改占比直接成功（m2 仍是 v1）')

// ---- 5. 入窖锁定新批次，之后改主档不再动它 ----
const { lockBatchSnapshot, unlockBatchSnapshot } = await import('../src/utils/masterSync.ts')
await lockBatchSnapshot('b2')
const b2Locked = await db.batches.get('b2')
ok(b2Locked.locked === true && b2Locked.snapshot[0].grade === '特级', 'b2 入窖锁定，快照保留特级写法')
await applyMaterialUpdate('m1', { processMethod: '酒蒸' })
const m1v3 = await db.materials.get('m1')
ok(m1v3.revision === 3, 'm1 再改炮制 → v3')
const b2LockedAfter = await db.batches.get('b2')
ok(b2LockedAfter.snapshot[0].processMethod === '蜜炙', '锁定后 b2 不随主档改动（仍是蜜炙）')
const b1LockedAfter = await db.batches.get('b1')
ok(b1LockedAfter.snapshot[0].processMethod === '生用', 'b1 始终保留入窖当时的生用')

// 删除窖藏 → 解锁并按最新主档重算
await db.cellars.clear()
const unlocked = await unlockBatchSnapshot('b1')
ok(unlocked === true, 'b1 删除全部窖藏后解锁')
const b1Unlocked = await db.batches.get('b1')
ok(!b1Unlocked.locked && b1Unlocked.snapshot[0].processMethod === '酒蒸' && b1Unlocked.snapshot[0].materialRevision === 3,
  '解锁后 b1 按最新主档 v3 重算写法')

// ---- 6. 导出随快照走 ----
const { exportSnapshot } = await import('../src/utils/db.ts')
const snapshot = await exportSnapshot()
const expB1 = snapshot.batches.find((b) => b.id === 'b1')
ok(expB1.snapshot[0].processMethod === '酒蒸', '导出档案：解锁批次跟随最新主档（酒蒸）')
const expB2 = snapshot.batches.find((b) => b.id === 'b2')
ok(expB2.locked && expB2.snapshot[0].processMethod === '蜜炙', '导出档案：锁定批次保留当时写法（蜜炙）')

console.log(process.exitCode ? '\n有断言失败' : '\n🎉 全部断言通过')

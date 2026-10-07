// 导入调和验证：旧版 v2 快照（无 revision / locked / 快照写法）导入后与新机制对齐
import 'fake-indexeddb/auto'

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('❌ FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('✅', msg)
  }
}

const { validateSnapshotJson } = await import('../src/utils/export.ts')

// 模拟旧版本导出：材料无 revision，配比无 materialRevision，批次快照只有 4 字段，
// 其中 b_old 有对应 cellar（已入窖），b_new 无 cellar（未入窖）
const legacySnapshot = {
  app: 'gbincense',
  dbVersion: 2,
  exportedAt: '2024-01-01T00:00:00.000Z',
  formulas: [
    { id: 'f1', name: '旧香方', scentType: '线香', usage: '静室', state: '在用', createdAt: '2024-01-01', totalRatio: 100, updatedAt: 1 }
  ],
  materials: [
    { id: 'm1', name: '沉香', origin: '海南', grade: '特级', processMethod: '生用', aromaNote: '', createdAt: '2024-01-01', updatedAt: 1 }
  ],
  proportions: [
    { id: 'p1', formulaId: 'f1', materialId: 'm1', ratio: 100, role: '君', note: '', seq: 1, updatedAt: 1 }
  ],
  batches: [
    { id: 'b_old', formulaId: 'f1', mixedAt: '2024-03-01', formingMethod: '挤条', quantity: 100, operator: '甲',
      snapshot: [{ materialId: 'm1', materialName: '沉香', ratio: 100, role: '君' }], snapshotAt: 1, updatedAt: 1 },
    { id: 'b_new', formulaId: 'f1', mixedAt: '2024-05-01', formingMethod: '压模', quantity: 50, operator: '乙',
      snapshot: [{ materialId: 'm1', materialName: '沉香', ratio: 100, role: '君' }], snapshotAt: 1, updatedAt: 1 }
  ],
  cellars: [
    { id: 'c1', batchId: 'b_old', startDate: '2024-03-05', endDate: '2025-03-05', temperatureC: 22, humidityPct: 60, container: '陶罐', state: '窖藏中', updatedAt: 1 }
  ],
  tastings: []
}

const result = validateSnapshotJson(legacySnapshot)
ok(result.ok, '旧版快照通过校验')
const payload = result.payload!
ok(payload.materials[0].revision === 1, '旧材料回填 revision=1')
ok(payload.proportions[0].materialRevision === 1, '旧配比回填 materialRevision=1')

const bOld = payload.batches.find((b) => b.id === 'b_old')!
const bNew = payload.batches.find((b) => b.id === 'b_new')!
ok(bOld.locked === true && bOld.lockedAt > 0, '有窖藏的批次按已入窖锁定')
ok(bNew.locked === false && bNew.lockedAt === 0, '无窖藏的批次保持未锁定')
ok(bOld.snapshot[0].grade === '特级' && bOld.snapshot[0].processMethod === '生用'
  && bOld.snapshot[0].materialRevision === 1, '锁定批次快照补齐当时写法（特级/生用 v1）')
ok(bNew.snapshot[0].grade === '特级' && bNew.snapshot[0].materialRevision === 1,
  '未锁定批次快照按当前配比+主档重算写法')

// 单方导出文件（旧格式）同样走调和
const { validateFormulaJson } = await import('../src/utils/export.ts')
const legacyFormula = {
  app: 'gbincense', kind: 'formula', dbVersion: 2, exportedAt: '2024-01-01T00:00:00.000Z',
  formula: legacySnapshot.formulas[0],
  materials: legacySnapshot.materials,
  proportions: legacySnapshot.proportions,
  batches: [legacySnapshot.batches[1]],
  cellars: [],
  tastings: []
}
const fResult = validateFormulaJson(legacyFormula)
ok(fResult.ok, '旧版单方文件通过校验')
ok(fResult.payload!.materials[0].revision === 1, '单方材料回填 revision')
ok(fResult.payload!.proportions[0].materialRevision === 1, '单方配比回填 materialRevision')
ok(fResult.payload!.batches[0].locked === false, '单方无窖藏的批次未锁定')
ok(fResult.payload!.batches[0].snapshot[0].processMethod === '生用', '单方未锁定批次快照写入当前主档写法')

// 新版文件里显式 locked=true 的批次即使无 cellar 也保留锁定写法（已出窖删窖藏但锁定信息随档案迁移的场景）
const explicitLocked = {
  ...legacySnapshot,
  cellars: [],
  batches: [{
    ...legacySnapshot.batches[0], id: 'b_x',
    locked: true, lockedAt: 123,
    snapshot: [{ materialId: 'm1', materialName: '沉香', ratio: 100, role: '君', grade: '二级', processMethod: '炒黄', materialRevision: 1 }]
  }]
}
const r3 = validateSnapshotJson(explicitLocked)
const bX = r3.payload!.batches.find((b) => b.id === 'b_x')!
ok(bX.locked === true && bX.snapshot[0].grade === '二级' && bX.snapshot[0].processMethod === '炒黄',
  '显式锁定批次保留导入快照里的当时写法，不被当前主档覆盖')

console.log(process.exitCode ? '\n有断言失败' : '\n🎉 导入调和全部断言通过')

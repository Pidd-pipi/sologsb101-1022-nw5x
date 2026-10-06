import {
  PROPORTION_ROLES,
  ROLE_WEIGHT,
  type ProportionRole,
  type RatioCheck
} from '@/types/proportion'

/** 配比合计与 100 的允许偏差（个百分点），超出即判定失衡 */
export const RATIO_TOLERANCE = 0.01

/** 四舍五入到指定小数位 */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 百分比格式化为字符串，默认保留一位小数 */
export function formatPercent(value: number, digits = 1): string {
  return `${round(value, digits)}%`
}

/** 合计一组配比 */
export function sumRatios(ratios: number[]): number {
  return round(
    ratios.reduce((sum, ratio) => sum + (Number.isFinite(ratio) ? ratio : 0), 0),
    2
  )
}

/** 与 100 的偏差（合计 - 100） */
export function diffFromHundred(total: number): number {
  return round(total - 100, 2)
}

/**
 * 归一化：把任意一组占比等比缩放到合计 100，并做百分位舍入。
 * 余数按小数部分从大到小补给各项，保证缩放后合计严格等于 100。
 */
export function normalizeRatios(ratios: number[]): number[] {
  const safe = ratios.map((ratio) => (Number.isFinite(ratio) && ratio > 0 ? ratio : 0))
  if (safe.length === 0) return []
  const total = safe.reduce((sum, ratio) => sum + ratio, 0)
  if (total <= 0) {
    const even = round(100 / safe.length, 2)
    return safe.map(() => even)
  }
  const scaled = safe.map((ratio) => (ratio / total) * 100)
  return distributeRemainder(scaled, 100)
}

/**
 * 等比缩放：按 factor 缩放全部占比，可选是否重新归一化到 100。
 * 负值与 NaN 视为 0，避免写回 Dexie 时出现脏数据。
 */
export function scaleRatios(ratios: number[], factor: number, renormalize = true): number[] {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1
  const scaled = ratios.map((ratio) => (Number.isFinite(ratio) ? ratio * safeFactor : 0))
  if (!renormalize) return scaled.map((ratio) => round(ratio, 2))
  return normalizeRatios(scaled)
}

/** 把一组浮点占比舍入到两位小数并保证合计恰好等于 target */
export function distributeRemainder(values: number[], target = 100): number[] {
  if (values.length === 0) return []
  const rounded = values.map((value) => round(value, 2))
  const total = sumRatios(rounded)
  let remainder = round(target - total, 2)
  if (Math.abs(remainder) < RATIO_TOLERANCE) return rounded
  const step = remainder > 0 ? 0.01 : -0.01
  const fractions = values
    .map((value, index) => ({ index, fraction: round(value, 2) - Math.floor(round(value, 2)) }))
    .sort((a, b) => (step > 0 ? b.fraction - a.fraction : a.fraction - b.fraction))
  let cursor = 0
  let guard = 0
  while (Math.abs(remainder) >= RATIO_TOLERANCE && guard < values.length * 400) {
    const target_ = fractions[cursor % fractions.length]
    rounded[target_.index] = round(rounded[target_.index] + step, 2)
    remainder = round(remainder - step, 2)
    cursor += 1
    guard += 1
  }
  return rounded
}

/** 君臣佐使权重：君 40 / 臣 30 / 佐 20 / 使 10 */
export function roleWeight(role: ProportionRole): number {
  return ROLE_WEIGHT[role] ?? 0
}

/** 角色在君臣佐使序列中的顺序，用于默认编排 */
export function roleOrder(role: ProportionRole): number {
  const index = PROPORTION_ROLES.indexOf(role)
  return index < 0 ? PROPORTION_ROLES.length : index
}

/**
 * 按君臣佐使权重排序（权重高的在前），权重相同则按占比降序。
 * 用于配比页「按君臣佐使权重」一键重排。
 */
export function sortByRoleWeight<T extends { role: ProportionRole; ratio: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const diff = roleWeight(b.role) - roleWeight(a.role)
    if (diff !== 0) return diff
    const ratioDiff = (b.ratio ?? 0) - (a.ratio ?? 0)
    if (ratioDiff !== 0) return ratioDiff
    return roleOrder(a.role) - roleOrder(b.role)
  })
}

/** 按占比降序排序，占比相同按角色权重 */
export function sortByRatioDesc<T extends { role: ProportionRole; ratio: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ratioDiff = (b.ratio ?? 0) - (a.ratio ?? 0)
    if (ratioDiff !== 0) return ratioDiff
    return roleWeight(b.role) - roleWeight(a.role)
  })
}

/** 按拖拽后的 id 顺序重排行，未出现在 order 中的行保持相对顺序追加在后 */
export function applyManualOrder<T extends { id: string }>(rows: T[], order: string[]): T[] {
  const map = new Map<string, T>(rows.map((row) => [row.id, row]))
  const ordered: T[] = []
  order.forEach((id) => {
    const row = map.get(id)
    if (row) {
      ordered.push(row)
      map.delete(id)
    }
  })
  rows.forEach((row) => {
    if (map.has(row.id)) ordered.push(row)
  })
  return ordered
}

/** 按拖拽结果计算新的 seq（从 1 开始） */
export function nextSeqMap(order: string[]): Record<string, number> {
  const map: Record<string, number> = {}
  order.forEach((id, index) => {
    map[id] = index + 1
  })
  return map
}

/** 配比合计校验：返回合计、偏差、是否平衡与提示文案 */
export function checkRatioTotal(ratios: number[]): RatioCheck {
  const total = sumRatios(ratios)
  const gap = diffFromHundred(total)
  const balanced = Math.abs(gap) <= RATIO_TOLERANCE
  if (balanced) {
    return { total, gap: 0, balanced: true, level: 'ok', message: `配比合计 100%，可以入方` }
  }
  const level: RatioCheck['level'] = Math.abs(gap) > 5 ? 'error' : 'warn'
  const direction = gap > 0 ? '超出' : '不足'
  return {
    total,
    gap,
    balanced: false,
    level,
    message: `配比合计 ${formatPercent(total, 2)}，${direction} ${formatPercent(Math.abs(gap), 2)}`
  }
}

/** 建议的单味占比（用于一键补齐到 100） */
export function suggestFillRatio(ratios: number[]): number {
  const gap = diffFromHundred(sumRatios(ratios))
  return gap < 0 ? round(Math.abs(gap), 2) : 0
}

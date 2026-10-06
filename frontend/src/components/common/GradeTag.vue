<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import { Collection, Medal, Trophy, WarningFilled } from '@element-plus/icons-vue'
import type { MaterialGrade } from '@/types/material'
import { GRADE_BG, GRADE_COLOR, GRADE_ICON } from '@/types/material'
import { SCORE_BAND_BG, SCORE_BAND_COLOR, SCORE_BAND_ICON, SCORE_BAND_LABEL, scoreBand } from '@/types/tasting'

const props = withDefaults(
  defineProps<{
    /** 香料等级：特级 / 一级 / 二级 */
    grade?: MaterialGrade | '未知'
    /** 品香评分 1-10，传入后优先按评分区间渲染 */
    score?: number | null
    /** 覆盖显示文案 */
    label?: string
    size?: 'default' | 'small' | 'large'
    /** 是否使用浅色描边风格 */
    plain?: boolean
    /** 是否展示图标 */
    icon?: boolean
    /** 附加后缀，如产地 */
    suffix?: string
  }>(),
  {
    grade: '未知',
    score: null,
    label: '',
    size: 'default',
    plain: false,
    icon: true,
    suffix: ''
  }
)

const ICONS: Record<string, Component> = {
  Trophy,
  Medal,
  Collection,
  WarningFilled
}

interface Tone {
  text: string
  bg: string
  color: string
  icon: string
}

/** 评分优先：传入 score 时按 9-10 上品 / 7-8 佳 / 5-6 中平 / 1-4 待调 分档 */
const tone = computed<Tone>(() => {
  if (props.score !== null && props.score !== undefined && Number.isFinite(props.score)) {
    const band = scoreBand(props.score)
    return {
      text: props.label || SCORE_BAND_LABEL[band],
      bg: SCORE_BAND_BG[band],
      color: SCORE_BAND_COLOR[band],
      icon: SCORE_BAND_ICON[band]
    }
  }
  if (props.grade && props.grade !== '未知') {
    const grade = props.grade
    return {
      text: props.label || grade,
      bg: GRADE_BG[grade],
      color: GRADE_COLOR[grade],
      icon: GRADE_ICON[grade]
    }
  }
  return { text: props.label || '未评级', bg: '#f2f1ef', color: '#8c8479', icon: 'WarningFilled' }
})

const iconComponent = computed<Component>(() => ICONS[tone.value.icon] ?? WarningFilled)

const style = computed(() => ({
  color: props.plain ? tone.value.color : '#ffffff',
  backgroundColor: props.plain ? tone.value.bg : tone.value.color,
  borderColor: tone.value.color
}))

const showScore = computed(
  () => props.score !== null && props.score !== undefined && Number.isFinite(props.score)
)
</script>

<template>
  <span class="grade-tag" :class="[`is-${size}`, { 'is-plain': plain }]" :style="style">
    <el-icon v-if="icon" class="grade-tag__icon">
      <component :is="iconComponent" />
    </el-icon>
    <span class="grade-tag__text">{{ tone.text }}</span>
    <span v-if="showScore" class="grade-tag__score mono">{{ score }} 分</span>
    <span v-if="suffix" class="grade-tag__suffix">{{ suffix }}</span>
  </span>
</template>

<style scoped>
.grade-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
}

.grade-tag.is-small {
  padding: 0 8px;
  font-size: 12px;
  line-height: 18px;
}

.grade-tag.is-large {
  padding: 4px 14px;
  font-size: 15px;
  line-height: 24px;
}

.grade-tag__icon {
  font-size: 13px;
}

.grade-tag__score,
.grade-tag__suffix {
  font-weight: 400;
  opacity: 0.9;
}
</style>

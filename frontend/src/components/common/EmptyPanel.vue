<script setup lang="ts">
import { computed } from 'vue'
import { Box, FolderOpened, MagicStick, Plus, Upload } from '@element-plus/icons-vue'

const props = withDefaults(
  defineProps<{
    /** 空状态标题 */
    title?: string
    /** 补充说明，指导用户下一步动作 */
    description?: string
    /** 主按钮文案（一般为「新建」），为空则不渲染 */
    actionText?: string
    /** 次要按钮文案 */
    secondaryText?: string
    /** 第三按钮文案，如「导入 JSON」 */
    thirdText?: string
    /** 是否展示「生成样例数据」按钮 */
    showSeed?: boolean
    /** 紧凑模式 */
    compact?: boolean
  }>(),
  {
    title: '暂无数据',
    description: '当前筛选条件下没有记录，可调整条件或新建一条。',
    actionText: '',
    secondaryText: '',
    thirdText: '',
    showSeed: false,
    compact: false
  }
)

const emit = defineEmits<{
  (event: 'action'): void
  (event: 'secondary'): void
  (event: 'third'): void
  (event: 'seed'): void
}>()

const iconComponent = computed(() => {
  if (props.showSeed) return MagicStick
  if (props.actionText) return Box
  return FolderOpened
})
</script>

<template>
  <div class="empty-panel" :class="{ 'is-compact': compact }">
    <el-icon class="empty-panel__icon">
      <component :is="iconComponent" />
    </el-icon>
    <h3 class="empty-panel__title">{{ title }}</h3>
    <p class="empty-panel__desc">{{ description }}</p>
    <div class="empty-panel__actions">
      <el-button v-if="actionText" type="primary" :icon="Plus" @click="emit('action')">
        {{ actionText }}
      </el-button>
      <el-button v-if="secondaryText" @click="emit('secondary')">{{ secondaryText }}</el-button>
      <el-button v-if="thirdText" :icon="Upload" plain @click="emit('third')">{{ thirdText }}</el-button>
      <el-button v-if="showSeed" type="success" plain :icon="MagicStick" @click="emit('seed')">
        生成样例数据
      </el-button>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.empty-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  background: #fbf9f5;
  border: 1px dashed #d9cfbe;
  border-radius: 12px;
  text-align: center;
}

.empty-panel.is-compact {
  padding: 24px 16px;
}

.empty-panel__icon {
  font-size: 34px;
  color: #b09a76;
}

.empty-panel__title {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: #3b342c;
}

.empty-panel__desc {
  margin: 0;
  max-width: 460px;
  font-size: 13px;
  line-height: 1.7;
  color: #8c8479;
}

.empty-panel__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}
</style>

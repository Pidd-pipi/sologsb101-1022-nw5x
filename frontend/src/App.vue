<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Component } from 'vue'
import { Box, Coin, Files, Histogram, Notebook, Sugar } from '@element-plus/icons-vue'
import { useFormulaStore } from '@/stores/formulaStore'
import { useMaterialStore } from '@/stores/materialStore'
import { useProportionStore } from '@/stores/proportionStore'
import { useCellarStore } from '@/stores/cellarStore'
import { DB_VERSION } from '@/utils/db'

const route = useRoute()
const router = useRouter()
const formulaStore = useFormulaStore()
const materialStore = useMaterialStore()
const proportionStore = useProportionStore()
const cellarStore = useCellarStore()

interface NavItem {
  path: string
  label: string
  icon: Component
  badge: string
  hint: string
}

const navItems = computed<NavItem[]>(() => [
  {
    path: '/formulas',
    label: '香方台账',
    icon: Notebook,
    badge: String(formulaStore.formulas.length),
    hint: '建香方与用途'
  },
  {
    path: '/materials',
    label: '香料库',
    icon: Files,
    badge: String(materialStore.materials.length),
    hint: '香料与炮制方式'
  },
  {
    path: '/proportions',
    label: '配比编排',
    icon: Histogram,
    badge: String(proportionStore.proportions.length),
    hint: '君臣佐使与占比校验'
  },
  {
    path: '/batches',
    label: '和香批次',
    icon: Box,
    badge: String(formulaStore.batches.length),
    hint: '和香工序与成型登记'
  },
  {
    path: '/cellar',
    label: '窖藏陈化',
    icon: Coin,
    badge: String(cellarStore.alerts.length),
    hint: '环境记录与出窖提醒'
  },
  {
    path: '/tastings',
    label: '品香评鉴',
    icon: Sugar,
    badge: String(formulaStore.tastings.length),
    hint: '香韵评分与 JSON 导出'
  }
])

const activePath = computed(() => {
  const matched = navItems.value.find((item) => route.path.startsWith(item.path))
  return matched?.path ?? '/formulas'
})

const currentTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : '香方配伍与窖藏陈化档案'))

function go(path: string): void {
  if (route.path === path) return
  void router.push(path)
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-header__brand">
        <span class="app-header__mark">香</span>
        <div>
          <h1 class="app-header__title">香方配伍与窖藏陈化档案</h1>
          <p class="app-header__sub">香方 · 香料 · 君臣佐使 · 和香成型 · 窖藏陈化 · 品香评鉴</p>
        </div>
      </div>
      <nav class="app-nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="app-nav__item"
          :class="{ 'is-active': activePath === item.path }"
          type="button"
          :title="item.hint"
          @click="go(item.path)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
          <em class="app-nav__badge">{{ item.badge }}</em>
        </button>
      </nav>
    </header>

    <main class="app-main">
      <p class="app-crumb muted">
        当前位置：{{ currentTitle }} · 本地结构版本 v{{ DB_VERSION }}
      </p>
      <router-view v-slot="{ Component: PageComponent }">
        <component :is="PageComponent" />
      </router-view>
    </main>

    <footer class="app-footer">
      <span>数据仅存于本浏览器（IndexedDB / Dexie + localStorage），不上传任何服务器。</span>
      <span>
        当前香方：{{ formulaStore.currentFormula ? formulaStore.currentFormula.name : '未选择' }}
        <template v-if="cellarStore.alerts.length > 0">
          · 临近出窖 {{ cellarStore.alerts.length }} 批
        </template>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: linear-gradient(120deg, #4a3524 0%, #6b4a2c 58%, #96683a 100%);
  color: #f7f0e4;
}

.app-header__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-header__mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 20px;
  font-weight: 700;
}

.app-header__title {
  margin: 0;
  font-size: 18px;
  letter-spacing: 2px;
}

.app-header__sub {
  margin: 2px 0 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(247, 240, 228, 0.78);
}

.app-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.app-nav__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #f7f0e4;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.app-nav__item:hover {
  background: rgba(255, 255, 255, 0.16);
}

.app-nav__item.is-active {
  background: #f7f0e4;
  color: #6b4a2c;
  font-weight: 600;
}

.app-nav__badge {
  font-style: normal;
  font-size: 11px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.app-main {
  flex: 1;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  padding: 18px 24px 32px;
}

.app-crumb {
  margin: 0 0 12px;
  font-size: 12px;
}

.app-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 24px 20px;
  font-size: 12px;
  color: #8c8479;
}
</style>

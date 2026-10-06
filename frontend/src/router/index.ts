import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/formulas'
  },
  {
    path: '/formulas',
    name: 'formula-list',
    component: () => import('@/pages/FormulaList.vue'),
    meta: { title: '香方台账', icon: 'Notebook' }
  },
  {
    path: '/materials',
    name: 'material-lib',
    component: () => import('@/pages/MaterialLib.vue'),
    meta: { title: '香料库与炮制', icon: 'Files' }
  },
  {
    path: '/proportions',
    name: 'proportion-board',
    component: () => import('@/pages/ProportionBoard.vue'),
    meta: { title: '配比与君臣佐使', icon: 'Histogram' }
  },
  {
    path: '/batches',
    name: 'batch-list',
    component: () => import('@/pages/BatchList.vue'),
    meta: { title: '和香工序与成型', icon: 'Box' }
  },
  {
    path: '/cellar',
    name: 'cellar-view',
    component: () => import('@/pages/CellarView.vue'),
    meta: { title: '窖藏与环境', icon: 'Coin' }
  },
  {
    path: '/tastings',
    name: 'tasting-board',
    component: () => import('@/pages/TastingBoard.vue'),
    meta: { title: '品香评鉴与导出', icon: 'Sugar' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/formulas'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '香方配伍与窖藏陈化档案'
  document.title = `${title} · 香方配伍与窖藏陈化档案`
})

export default router

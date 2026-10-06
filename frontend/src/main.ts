import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from '@/App.vue'
import router from '@/router'
import { initDatabase, stampDbVersion } from '@/utils/db'
import '@/styles/main.css'

async function bootstrap(): Promise<void> {
  // 首屏先打开 IndexedDB 并在空库时播种演示档案，保证任一页面直链都有数据
  await initDatabase()
  stampDbVersion()

  const app = createApp(App)

  Object.entries(ElementPlusIconsVue).forEach(([key, component]) => {
    app.component(key, component)
  })

  app.use(createPinia())
  app.use(router)
  app.use(ElementPlus, { locale: zhCn })

  app.mount('#app')
}

void bootstrap()

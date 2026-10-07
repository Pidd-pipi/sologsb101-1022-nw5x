# 香方配伍与窖藏陈化档案（gbincense）

面向香道工作室与制香作坊的配方留档工具：把每款香方的香料配比、炮制方式、和香成型、窖藏陈化与品香评鉴逐环记录，形成可复用的香方档案。

核心动作：**建香方与用途 → 维护香料库与炮制方式 → 按君臣佐使配比 → 排和香工序与成型 → 管窖藏批次环境 → 录品香评分**。

纯前端单页应用（Vue 3 + TypeScript + Element Plus + Vite + Pinia + Vue Router），**无后端、无数据库服务、无 API 服务**，全部数据保存在浏览器本地（IndexedDB / Dexie + 少量 localStorage 元数据），刷新或重启浏览器后依然存在。

---

## 一、Docker 一键启动（推荐）

```bash
# 1. 首次启动先复制环境变量模板
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

启动完成后访问：**http://localhost:22822**

常用命令：

```bash
docker compose ps                 # 查看服务状态（healthy 表示就绪）
docker compose logs -f frontend   # 查看 nginx 日志
docker compose down               # 停止并移除容器
docker compose up -d --build      # 代码改动后重新构建
```

> 端口可在 `.env` 中通过 `FRONTEND_PORT` 修改（默认 `22822`）；容器名固定为 `${COMPOSE_PROJECT_NAME:-gbincense}-frontend`。
> `docker-compose.yml` 已用顶层 `name: gbincense` 兜底，任意目录名（含中文）下 `docker compose config --quiet` 都不会报错。
> 容器无状态：不连接数据库、不挂载命名卷，数据全部在浏览器本地；换设备请用应用内「导出全量 JSON」与「导入 JSON」。

---

## 二、技术栈

| 分类 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Vue 3（`<script setup>` + Composition API） | 全部页面与组件使用组合式 API |
| 语言 | TypeScript（`strict: true`，`noUnusedLocals` / `noUnusedParameters` 均开启） | `npm run build` 内含 `vue-tsc --noEmit` 类型检查 |
| UI 组件库 | Element Plus 2.x（含 `@element-plus/icons-vue`） | 表格、抽屉、对话框、表单、滑块、提示 |
| 构建工具 | Vite 6 | 开发服务器端口 22822 |
| 状态管理 | Pinia 2（setup store） | `formulaStore` / `materialStore` / `proportionStore` / `cellarStore` |
| 路由 | Vue Router 4（history 模式） | nginx 侧配合 `try_files $uri $uri/ /index.html` 做 SPA fallback |
| 本地存储 | Dexie 4（IndexedDB 封装）+ localStorage | 库名 `gbincense`，含结构版本号与 `upgrade` 迁移逻辑 |
| 拖拽排序 | HTML5 原生 `draggable` + `dragstart/dragover/drop` | 未引入 `vuedraggable` / `dnd-kit` 等额外依赖 |
| 容器化 | Docker 多阶段：`node:20-alpine` → `nginx:alpine` | 构建阶段执行类型检查与打包，运行阶段仅托管静态产物 |

---

## 三、本地开发方式

```bash
cd frontend
npm install
npm run dev        # 开发服务器 http://localhost:22822
npm run build      # 类型检查 + 生产构建，产物在 frontend/dist
npm run preview    # 本地预览构建产物（http://localhost:22822）
```

要求 Node.js 20 及以上（与 Docker 构建阶段镜像 `node:20-alpine` 保持一致）。

---

## 四、目录结构与页面路由

```
sologsb101-1022/
├── README.md
├── docker-compose.yml          # 顶层 name 兜底，无 version 字段，无挂卷
├── .env / .env.example         # COMPOSE_PROJECT_NAME=gbincense、FRONTEND_PORT=22822
├── .gitignore
├── sologsb101-1022.md          # 提示词原文（只读）
└── frontend/
    ├── Dockerfile              # node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf              # SPA fallback + gzip + /assets/ 长缓存
    ├── .dockerignore
    ├── package.json / package-lock.json
    ├── tsconfig.json / vite.config.ts / index.html
    ├── public/favicon.svg
    └── src/
        ├── main.ts             # 入口：先 initDatabase() 播种，再挂载应用
        ├── App.vue             # 顶部导航（6 个模块）+ 底部数据说明
        ├── env.d.ts
        ├── styles/main.css
        ├── types/              # formula.ts material.ts proportion.ts batch.ts cellar.ts tasting.ts
        ├── stores/             # formulaStore.ts materialStore.ts proportionStore.ts cellarStore.ts
        ├── components/common/  # GradeTag.vue FilterBar.vue StatBadge.vue EmptyPanel.vue
        ├── hooks/              # useProportion.ts useIdbTable.ts
        ├── pages/              # FormulaList.vue MaterialLib.vue ProportionBoard.vue
        │                       # BatchList.vue CellarView.vue TastingBoard.vue
        ├── router/index.ts
        └── utils/              # ratio.ts db.ts master.ts export.ts
```

| 路由 | 页面 | 主要职责 | 消费模型 |
| --- | --- | --- | --- |
| `/formulas` | 香方台账 | 新建/编辑香方、按香型与用途与状态筛选、卡片回显配比合计与品香均分、状态流转（草稿 → 在用 → 停用）、单方 JSON 导出与导入校验 | Formula、Tasting、Proportion、Batch |
| `/materials` | 香料库与炮制 | 香料增删改、按等级/产地/炮制方式检索、就地改炮制方式、显示被哪些香方引用、清理闲置香料 | Material、Proportion |
| `/proportions` | 配比与君臣佐使 | 君臣佐使编排、占比实时校验 100%、一键等比缩放与归一化、**HTML5 原生拖拽排序写回 `seq`**、按权重一键重排 | Proportion、Formula、Material |
| `/batches` | 和香工序与成型 | 登记和香批次（自动固化配比快照）、快照与当前方子逐味对照、开批次前校验配比是否平衡 | Batch、Formula、Proportion |
| `/cellar` | 窖藏与环境 | 入窖/出窖登记、温湿度就地录入、按剩余天数排序的临近出窖提醒、状态流转（窖藏中 → 已出窖）、批量处理逾期 | Cellar、Batch、Formula |
| `/tastings` | 品香评鉴与导出 | 香韵 / 留香 / 烟气评分录入、同批次多次评鉴取均分并回写香方列表、结构版本查看、全量 JSON 导出与导入校验 | Tasting、Batch、全部模型 |

`/` 与未匹配路径均重定向到 `/formulas`；页面组件全部懒加载，`router.afterEach` 同步 `document.title`。

---

## 五、IndexedDB 库名与数据存储说明

- **库名**：`gbincense`（`frontend/src/utils/db.ts` 中的 `new IncenseDatabase()` → `super('gbincense')`）。
- **结构版本号**：`export const DB_VERSION = 3`，同时写入 localStorage 键 `gbincense:db-version` 便于比对。

| 表 | 主键与索引 | 说明 |
| --- | --- | --- |
| `formulas` | `id, name, scentType, usage, state, createdAt, totalRatio, updatedAt` | 香方主档，`totalRatio` 由配比页实时回写 |
| `materials` | `id, name, origin, grade, processMethod, rev, updatedAt` | 香料库与炮制方式；`rev` 为主档修订号，仅等级/炮制变更时 +1 |
| `proportions` | `id, formulaId, materialId, role, materialRev, seq, updatedAt` | 君臣佐使配比，`materialRev` 记录所停主档写法，主档一改未固化配比同事务推进 |
| `batches` | `id, formulaId, mixedAt, formingMethod, updatedAt` | 和香批次，含 `snapshot` 配比快照（每条带等级/炮制/`materialRev`） |
| `cellars` | `id, batchId, startDate, endDate, state, updatedAt` | 窖藏批次与环境读数；存在窖藏记录的批次即锁定快照写法 |
| `tastings` | `id, batchId, tastedAt, smokeScore, updatedAt` | 品香评鉴 |

**主档一改、档案跟着改的联动规则（v3）**：

1. 香料主档仅在「等级 / 炮制方式」变化时推进 `Material.rev`（改名、改产地、香气描述不推进）。
2. 推进在同一个 Dexie 事务内完成：引用它的**未固化配比** `materialRev` 全部更新到最新；**未入窖批次**快照里该味的名称/等级/炮制/修订号按最新主档重算。
3. **已入窖批次**（`cellars` 表存在对应记录）跳过联动，锁住入窖当时的写法；入窖登记时会先把快照刷到最新主档再锁。删除窖藏记录使批次回到未入窖状态时，快照重新对齐主档。
4. 另一个开着的页面通过 Dexie 4 的跨标签 liveQuery 自动收到变更、按最新主档重算视图；保存时若发现自己拿着旧修订号（`expectedRev` / `expectedMaterialRev` 不符），抛 `MasterConflictError`，页面保留表单草稿，按钮变为「带着草稿按最新主档重试」。
5. 历史数据没有修订号：v2 → v3 升级时 `rev` / `materialRev` 统一按当前值回填为 1，历史批次快照按主档当前值补齐等级与炮制（从此刻起再改主档才开始区分联动/锁定）。v2 导出 JSON 导入时同样自动回填。

- **版本迁移**：`version(1).stores({...})` 为初版结构；`version(2)` 补 `seq` 与日期索引并回填历史脏数据；`version(DB_VERSION)`（v3）引入主档修订号：回填 `materials.rev`、`proportions.materialRev`，并给批次快照条目补齐 `grade` / `processMethod` / `materialRev`。各版本迁移均用 `toCollection().modify(...)` 链式执行，老库逐级升级。
- **首屏自动播种**：`main.ts` 在挂载前调用 `initDatabase()`，其中包含 `if ((await db.formulas.count()) === 0) { await seedDatabase() }`，写入 3 款香方 → 7 条配比 / 2 个和香批次 → 2 条窖藏 / 2 条品香（香方 → 配比/批次 → 窖藏/品香 三层互相引用）。播种使用固定 id + `bulkPut`，**幂等**，重复调用不会产生重复数据。
- **localStorage 元数据**：`gbincense:db-version`（结构版本）、`gbincense:last-backup-at`（上次导出时间）、`gbincense:ui-prefs`（当前香方、配比与窖藏排序方式）。
- **导出 / 导入**：`utils/export.ts` 提供 `exportFormulaJson()`（单方）与 `exportSnapshotJson()`（全量），导入前用 `validateFormulaJson()` / `validateSnapshotJson()` 做字段与枚举校验，校验失败会提示具体错误且不写库。
- **无命名卷、无后端**：数据只在本浏览器，清理浏览器站点数据即清空；应用内提供「重置演示数据」按钮可恢复样例档案。

---

## 六、常见问题

1. **端口被占用**：修改 `.env` 中的 `FRONTEND_PORT`（例如 `FRONTEND_PORT=22823`）后重新 `docker compose up -d --build`；本地开发改 `frontend/vite.config.ts` 的 `server.port`。
2. **favicon 或静态资源 403**：`Dockerfile` 在 `COPY --from=builder /app/dist /usr/share/nginx/html` 之后紧接 `RUN chmod -R a+rX /usr/share/nginx/html`，避免宿主机源文件权限为 `0600` 时 nginx worker（uid=101）读不到文件，已被规避。
3. **刷新子路由 404**：`nginx.conf` 已配置 `try_files $uri $uri/ /index.html;`；若自行部署到其它 Web 服务器，请同样配置 history fallback。
4. **换浏览器 / 换设备看不到数据**：数据仅存于当前浏览器的 IndexedDB，请在「品香评鉴」页导出全量 JSON，再在新环境导入。
5. **配比合计不是 100%**：配比页顶部会实时显示合计与偏差，可点「一键等比缩放至 100%」或「按君臣佐使重排」后微调；批次页登记前也会提示当前方子是否平衡。
6. **浏览器隐私模式**：部分浏览器的无痕窗口会禁用或限制 IndexedDB，可能导致看不到演示数据，请使用普通窗口访问。

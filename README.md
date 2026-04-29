# 资产管家

本地运行的个人资产记录与分析工具。  
数据全部存储在本机 SQLite，不依赖任何云服务。

**技术栈**：Next.js 14（App Router）· TypeScript · Tailwind CSS · SQLite（better-sqlite3）· Recharts

**源码**：<https://github.com/mengzi0826/asset-manger>

面向 AI / 协作者的运行与代理约定见仓库内 [AGENTS.md](./AGENTS.md)。

---

## 功能一览

### 总览

- 净资产（总资产 − 总负债）+ 较上次快照的涨跌幅
- 各币种（CNY / USD / HKD）原币资产汇总
- 有负债时显示总资产、总负债、负债率
- 资产构成饼图（6 大类：现金 / 存款 / 基金 / 证券 / 加密货币 / 其他）+ 永久图例，左右布局，鼠标悬停高亮联动
- 净值走势折线图（面积图，每日首次访问或变更资产自动记录一个快照）
- 资产摘要：四个指标瓦片（累计变化、浮动盈亏、**证券今日**盈亏、加权年化）+ 即将到期列表（60 天内）；「证券今日」依赖最近一次股票价格刷新写入的当日涨跌字段，无数据时显示「—」
- 智能建议（现金占比、集中度、高波动资产、杠杆率、流动性不足等）
- 最近变动日志（6 条）

### 证券

独立菜单，专属看板（路由 `/securities`）：

- KPI 条：证券总市值、浮动盈亏（成本回报率）、按市场分组（沪深 A 股 / 港股 / 美股）
- 证券总市值走势图（来自每日组合快照）
- 浮动盈亏走势图（从价格刷新记录重建，反映盈亏随时间的变化）
- 持仓明细，按市场分组（沪深 A 股 → 港股 → 美股），每行附 mini sparkline；分组标题行展示该市场 **今日盈亏** 与 **累计浮动盈亏**（折算到基准货币）

### 持仓

- 全量资产列表，多条件过滤（币种 × 账户）
- 账户（小类）管理：在 6 大类下自由创建账户（如"工行活期"、"雪球账户"、"房贷"）
- 资产表单，按大类动态展示字段：
  - 现金 / 加密货币 / 基金 → 直接填金额
  - 存款 / 负债 → 金额 + 年化利率 + 起息日 + 到期日
  - 证券 → 份额 + 买入均价 + 当前价 + **股票代码**
- 证券类资产新增时内置**股票搜索**：输入名称或代码，从东方财富自动补全「名称 / 代码 / 计价货币」

### 历史

- 完整净值走势图，可手动"立即记录快照"
- 全量变动明细（create / update / delete），update 显示字段级 diff

### 设置

- 基准货币切换（CNY / USD）
- 汇率管理：一键刷新（聚合数据 API）或手动覆盖
- 聚合数据 AppKey：汇率与股票价格分开配置（也可仅使用环境变量，见下文）
- 数据备份：导出 JSON / 合并或覆盖导入 JSON

---

## 快速上手

```bash
git clone https://github.com/mengzi0826/asset-manger.git
cd asset-manger
# 需要 Node.js 18+
npm install
npm run dev
# 浏览器访问 http://127.0.0.1:3000
```

> **macOS 常见报错**：若出现 `EMFILE: too many open files`，先执行 `ulimit -n 10240` 再启动。

生产构建：

```bash
npm run build
npm run start
```

默认监听 `127.0.0.1:3000`，不向局域网暴露。若需修改，编辑 `package.json` 的 `dev` / `start` 脚本。

---

## 外部 API 配置

应用依赖两个聚合数据（[juhe.cn](https://www.juhe.cn)）接口，均需在「设置」页配置 AppKey，或通过环境变量传入：


| 功能     | 接口           | 环境变量                |
| ------ | ------------ | ------------------- |
| 汇率刷新   | 聚合数据汇率 API   | `JUHE_FX_APPKEY`    |
| 股票价格刷新 | 聚合数据股票数据 API | `JUHE_STOCK_APPKEY` |


- **汇率**：距上次非手动拉取满 **8 小时**后再自动请求；支持货币仅 **CNY / USD / HKD**；网络失败时使用缓存，也可手动输入汇率（标记为「手动」）。
- **股票价格**：每日 10:00 和 14:00（北京时间）各自动刷新一次；沪深 A 股 / 港股 / 美股三市场分别对应不同接口端点。刷新成功时会把接口返回的**当日单价涨跌额、涨跌幅**一并写入 `asset` 表（`change_amount` / `change_percent`），供总览「证券今日」与证券页「今日盈亏」汇总使用。未配置 AppKey 时跳过刷新，不影响其他功能。

### 代理设置

本地开发常见代理工具（Clash、Surge 等 Fake-IP 模式）下，Node 原生 `fetch` 默认不走系统代理。应用统一读取以下环境变量作为代理地址：

```
FX_PROXY / HTTPS_PROXY / https_proxy / HTTP_PROXY / http_proxy / ALL_PROXY / all_proxy
```

`npm run dev` 脚本已默认注入 `FX_PROXY=http://127.0.0.1:7890`（Clash 默认端口）。  
无代理或端口不同请使用：

```bash
npm run dev:noproxy
# 或
FX_PROXY=http://127.0.0.1:你的端口 npm run dev
```

---

## 数据持久化


| 路径                     | 说明                    |
| ---------------------- | --------------------- |
| `./data/assets.db`     | SQLite 主数据库（首次启动自动创建） |
| `./data/assets.db-wal` | WAL 预写日志（正常运行时存在）     |
| `./data/assets.db-shm` | 共享内存文件                |


`data/` 目录已加入 `.gitignore`，不会被提交。

### 备份建议

1. **JSON 备份（推荐）**：「设置 → 数据备份」→「导出 JSON 备份」，人类可读，定期存档。
2. **数据库文件备份**：关闭应用后直接复制 `data/assets.db`。

### 恢复

「设置 → 数据备份」→ 选择 JSON 文件后选择模式：

- **合并**：按主键 upsert，不丢失现有数据
- **覆盖**：清空所有表（保留分类）后全量导入

---

## 颜色惯例

全项目遵循**中国市场红涨绿跌**惯例：

- 涨 / 盈利 / 正向 → 红色（`gain`）
- 跌 / 亏损 / 负向 → 绿色（`loss`）

---

## 项目结构

```
app/
  page.tsx                   # 总览 Dashboard
  securities/                # 证券看板（独立页）
  assets/                    # 持仓列表 + 账户管理 + 资产表单
  history/                   # 历史走势 + 变动明细
  settings/                  # 汇率 / API Key / 备份
  api/
    assets/[id]/             # 资产 CRUD
    accounts/[id]/           # 账户 CRUD
    categories/              # 大类只读
    fx/                      # 汇率刷新 + 手动覆盖
    stocks/                  # 股票价格刷新
    securities/search/       # 股票搜索（东方财富 suggest）
    history/                 # 手动写快照
    settings/                # 键值设置
    backup/                  # 导出 / 导入 JSON
lib/
  db.ts                      # SQLite 单例 + 自动迁移 + 种子数据
  schema.sql                 # 建表 DDL
  valuation.ts               # 资产估值 + 净资产 / 负债分离
  history.ts                 # 变动日志 + 每日快照 + 证券盈亏重建 + 今日盈亏（computeTodayStockPnL）
  fx.ts                      # 汇率拉取 / 缓存 / 换算
  stocks.ts                  # 股票代码解析 + 价格与当日涨跌字段刷新落库
  advisor.ts                 # 智能建议规则引擎
  net.ts                     # 统一代理 dispatcher（undici）
  juheKeys.ts                # AppKey 读取（设置 DB 优先，env 备选）
  currencies.ts              # 支持的货币常量
  time.ts                    # 北京时区工具函数
  utils.ts                   # 格式化工具（金额 / 百分比 / 日期）
  useTheme.ts                # 客户端深浅主题 hook
components/
  TopNav.tsx                 # 顶部导航（总览·持仓·证券·历史·设置）
  ThemeToggle.tsx            # 深色 / 浅色模式切换
  charts/
    AllocationChart.tsx      # 资产构成饼图 + 永久图例
    HistoryChart.tsx         # 净值走势面积图
    SecuritiesChart.tsx      # 证券看板（走势 + 盈亏趋势 + 分组明细）
```

---

## 数据库表


| 表                    | 说明                                |
| -------------------- | --------------------------------- |
| `category`           | 6 大资产类别（现金/存款/基金/证券/加密货币/负债/其他）   |
| `account`            | 账户（大类下的小类，如"工行活期"）                |
| `asset`              | 资产明细，含 `symbol`（股票代码）；证券类另有 `change_amount` / `change_percent`（当日涨跌，由股票接口刷新落库） |
| `fx_rate`            | 汇率缓存                              |
| `setting`            | 键值配置（基准货币、AppKey、最后刷新时间等）         |
| `asset_change`       | 字段级变动日志（create / update / delete） |
| `portfolio_snapshot` | 每日净值快照（按基准货币，每天幂等一条）              |


---

## 估值逻辑


| 资产类型                     | 估值方式                                      |
| ------------------------ | ----------------------------------------- |
| 现金 / 存款 / 基金 / 加密货币 / 负债 | 直接使用 `amount`                             |
| 证券（股票/ETF/LOF）           | `quantity × (current_price ?? unit_cost)` |
| 净资产                      | 总资产（非负债） − 总负债                            |


多币种资产统一换算到基准货币（CNY 或 USD），缺失汇率时在页面顶部给出提示。

---

## 智能建议规则


| 规则        | 触发条件                      | 级别  |
| --------- | ------------------------- | --- |
| 现金占比过高    | 现金 > 30% 总资产              | 提醒  |
| 单类集中度过高   | 任一大类 > 60%                | 提醒  |
| 加密货币占比高   | 加密货币 > 20%                | 警告  |
| 存款即将到期    | 30 天内到期                   | 提示  |
| 无外币对冲     | CNY 总额 > 50 万 / USD > 7 万 | 提示  |
| 负债率偏高     | 总负债 / 总资产 > 40%           | 警告  |
| 流动性不足覆盖负债 | 现金 < 总负债 × 1.5            | 警告  |
| 资不抵债      | 净资产 < 0                   | 危险  |


规则引擎在 `lib/advisor.ts`，可自由扩展。

---

## 常见问题

**"部分汇率缺失"**  
→ 到「设置 → 汇率管理」点"刷新"，或手动输入汇率。

**股票价格未更新**  
→ 确认「设置」中已配置聚合数据股票 AppKey；仅在北京时间 10:00 / 14:00 后各自动刷新一次，可在「设置 → 股票」手动触发刷新。

**总览「证券今日」或证券页「今日盈亏」一直为「—」**  
→ 需至少成功刷新过一次股票价格，接口才会写入当日涨跌；新建仓或从未拉取到行情时该项不参与汇总。

`**EMFILE: too many open files`**  
→ `ulimit -n 10240` 后重启 dev server。

**想换端口**  
→ 修改 `package.json` 的 `dev` / `start` 脚本中 `-p <port>` 参数。
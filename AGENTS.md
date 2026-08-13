# AGENTS.md

给后续 AI agent 与维护者的项目备忘。只写**非直觉、必须遵守**的约定；产品说明与上手步骤见 [README.md](./README.md)。

改代码前先读本文件对应小节。不要凭旧文档或 `.cursor/rules` 里过时描述行事——以源码为准。

---

## 这是什么

个人本机资产管家：Next.js 14 App Router + SQLite。单用户、绑 `127.0.0.1`，数据在 `data/assets.db`。

不要把它做成多租户、不要接云同步、不要在代码里写死第三方 Key。

---

## 硬约束

1. **时区一律北京**（`Asia/Shanghai`）。`next.config.mjs` 与 `lib/db.ts` 会设 `process.env.TZ`。写入时间只用 `lib/time.ts` 的 `nowCn()` / `todayCn()` / `toCnIso()`。禁止 `new Date().toISOString()` 存库。新建表的 DEFAULT 用 `lib/schema.sql` 里 `strftime(..., 'now', '+8 hours') || '+08:00'` 的写法，不要用 `CURRENT_TIMESTAMP`。
2. **`nowCn()` / `toCnIso()` 精度到整点小时**（分秒恒为 `00`）。展示用 `formatCnDateTime` / `formatCnDate`，与存库粒度对齐；它们会兼容历史 UTC / 无时区字符串。
3. **聚合 AppKey 禁止写死**。只经 `lib/juheKeys.ts`：`setting` 表 `juhe_fx_appkey` / `juhe_stock_appkey` **优先于** `JUHE_FX_APPKEY` / `JUHE_STOCK_APPKEY`。设置页可填可清。
4. **支持货币只有 CNY / USD / HKD**（`lib/currencies.ts`）。基准货币 UI 只有 CNY / USD。
5. **涨跌色：红涨绿跌**。Tailwind token 是 `gain`（红）/ `loss`（绿），不要按欧美习惯对调。
6. **页面默认 `export const dynamic = "force-dynamic"`**。不要为了缓存把行情/估值页改成静态。
7. **已有库不做破坏性重建**。Schema 是 `CREATE TABLE IF NOT EXISTS`；加列走 `lib/db.ts` 的 `migrateSchema`（幂等 `ALTER`）。

---

## 运行环境

- 开发机：macOS，本机常年开着 Clash / Mihomo 类代理，HTTP 口 `127.0.0.1:7890`，多为 **Fake-IP**。
- **当前代码用 `undici.fetch` 直连**，没有 `ProxyAgent`，没有 `lib/net.ts`，`package.json` 的 `dev` / `start` **不注入** `FX_PROXY`。也不存在 `dev:noproxy`。
- Fake-IP 下 Node DNS 常解析到 `198.18.x.x`，于是 `op.juhe.cn` / `web.juhe.cn` / `searchapi.eastmoney.com` 会 `ENOTFOUND`。这是环境问题。不要为此把 Key 写进源码；也不要擅自加回已删除的代理层，除非用户明确要求。
- 启动：`npm run dev` → `127.0.0.1:3000`。不要 `kill` 后用裸 `next dev` 却改掉 host/port 约定。
- SQLite：`better-sqlite3` 是 native 模块，已在 `next.config.mjs` 里标为 `serverComponentsExternalPackages`。

---

## 目录怎么读

| 路径 | 职责 |
| --- | --- |
| `app/page.tsx` | 总览 |
| `app/assets/` | 列表、账户、表单、证券交易对话框 |
| `app/securities/` | 证券看板 |
| `app/history/` | 快照曲线 + 变动日志 |
| `app/settings/` | Key、汇率、股价、备份 |
| `app/api/` | 薄路由，业务在 `lib/` |
| `lib/db.ts` | SQLite 单例、迁移、种子、setting 读写 |
| `lib/schema.sql` | DDL |
| `lib/valuation.ts` | 单笔估值、净资产拆分 |
| `lib/history.ts` | 变动日志、每日快照、今日盈亏、价格历史 |
| `lib/fx.ts` | 汇率拉取 / 换算 / 手动覆盖 |
| `lib/stocks.ts` | 代码解析、行情刷新、刷新日志 |
| `lib/time.ts` | 时区、8h 汇率、10:00/14:00 股票锚点 |
| `lib/juheKeys.ts` | Key 解析 |
| `lib/advisor.ts` | 总览建议规则 |
| `lib/autoRefresh.ts` | 进程内每 60s 自动检查刷新 |
| `lib/assetsNav.ts` | 资产列表 tab 回跳 |
| `app/_components/DataFreshness.tsx` | 总览汇率/股价新鲜度 |
| `components/charts/` | 饼图、净值、证券图 |

---

## 数据模型

分类种子在 `seedCategories`（7 个，**含负债**）：

`cash` / `deposit` / `fund` / `securities` / `crypto` / `liability` / `other`

层次：`category` → `account`（用户建的小类）→ `asset`。

| 表 | 用途 |
| --- | --- |
| `asset` | 明细。证券用 `quantity` + `unit_cost` + `current_price` + `symbol`；多数其它类型用 `amount`。`change_*` 只服务证券今日盈亏。 |
| `fx_rate` | 汇率缓存。`source`：`juhe` 或 `manual`。旧 `frankfurter` 下次成功刷新会被覆盖。 |
| `setting` | 键值：`base_currency`、两枚 AppKey、`last_stocks_refresh_at`、`last_fx_refresh_error`、`last_stocks_refresh_error` |
| `asset_change` | create / update / delete；update 的 `field_changes` 为 JSON diff |
| `portfolio_snapshot` | 每日净资产快照，`UNIQUE(date, base_currency)`，写入即覆盖当天 |
| `stock_refresh_log` | 每次单股请求一条，约 30 天清理；不进 JSON 备份 |
| `stock_price_daily` | 每标的每个**行情会话日**一条价格，供盈亏走势；在 JSON 备份里 |

`change_quote_date`：接口 `date`（优先）或 `time` 解析出的北京 `YYYY-MM-DD`。解析不到就写 **null**，禁止回落成 `todayCn()`。空日期不计入今日盈亏。`change_updated_at` 是历史列，今日判定**不要再用它**。不要在 `migrateSchema` 里把 null 日期再填回去。

JSON 备份（`app/api/backup`）`version: 2` 导出：category / account / asset / fx_rate / setting / asset_change / portfolio_snapshot / **stock_price_daily**。不含 `stock_refresh_log`。覆盖模式会先 `DELETE` 日线、刷新日志和上述业务表（分类除外）再导入。旧备份无 `stock_price_daily` 仍可导入。

---

## 估值

`computeAssetValue`：`amount > 0` 则用金额，否则 `quantity × (current_price ?? unit_cost ?? 0)`。

`valueAll`：负债计入 `totalLiabilities`（正数），不计入 `totalAssets`。`total` / `netWorth` = 总资产 − 总负债。`byCategory.liability` 是负债合计。饼图不要把负债画进去（总览已过滤）。

换算：`lib/fx.ts` 的 `convert`。缺正向前查反向 `1/rate`。仍没有则 `base_value = 0` 并记入 `missingRates`。

---

## 汇率

- 接口：`http://op.juhe.cn/onebox/exchange/currency`（`lib/fx.ts`）。
- 三个币种只需 3 次请求（两两配对，接口返回双向）。
- 自动：`shouldRefreshFxEvery8h`，看 `fx_rate` 里 `source != 'manual'` 的 `MAX(fetched_at)`。不是「每天 10:00 一次」。
- `GET /api/fx?refresh=1` 强制。手动 `POST /api/fx` 写 `source=manual`。
- Key 级 fatal（错误 Key、额度等）停止后续币对；单对网络失败会重试 3 次。
- 整批失败写入 `setting.last_fx_refresh_error`，成功则删除。总览用它提示，不要只打 console。
- `kickoffRatesRefresh()` 不阻塞 SSR；`ensureRates()` 仍存在但页面主路径已改用 kickoff + 调度器。

---

## 股票

解析**只**走 `parseStockSymbol`（`lib/stocks.ts`）。表单保存前把 `symbol` 转大写。

| 输入 | 市场 |
| --- | --- |
| `SH`/`SZ` + 6 位 | 沪深 |
| 6 位数字 | 按 `hsGidPrefixForSixDigit`：`5xxxxx` ETF 是**沪市**，不要当成深市 |
| `HK` + 数字，或 4–5 位数字 | 港股，`num` 补到 5 位 |
| 字母（可去 `$`、`.US` 等后缀） | 美股 |

端点：沪深 `.../hs?gid=`，港股 `.../hk?num=`，美股 `.../usa?gid=`。价格字段：沪深 `nowPri`，港美 `lastestpri`。涨跌幅接口是百分数（`0.13` = 0.13%），入库除以 100 成小数。

### 刷新节奏

`refreshStockPrices({ force })`：

- **仅自动刷新**在北京周六日 `skipped: "weekend"`，不打接口。`force: true`（设置页手动刷新）周末仍会请求。
- 非 force：未到当日 10:00 → `before_morning`；已拉过当前锚点 → `up_to_date`。
- 锚点：10:00 与 14:00（`STOCK_REFRESH_HOURS_BEIJING`）。成功或失败只要实际请求过，就写 `last_stocks_refresh_at`。
- 模块锁：同一进程只允许一次刷新在飞。
- **失败分支不 `UPDATE`**。额度耗尽也不要提前 `break` 整批；后续标的仍各请求一次。
- 成功写入 `change_quote_date = quoteSessionYmd`（可为 null）。`stock_price_daily` 只用会话日，没有会话日就不要 upsert。
- 整批 `updated_count === 0 && failed_count > 0` 时写 `last_stocks_refresh_error`；有成功则删除。

`GET /api/stocks?refresh=1` 为强制（周末也会打接口）。`maxDuration = 300`。

### 今日盈亏

以 `computeTodayStockPnL`（`lib/history.ts`）为准。

规则：

- 仅 `change_quote_date === todayCn()` 的标的进入汇总；空日期不计入。
- 单价涨跌用落库的 `change_amount` / `change_percent`。
- 股数用 `mapSecurityQuantityBeforeFirstEditToday`：从今日 `asset_change` 的 `quantity` diff 反推日初股数。当天减仓/清仓，已卖部分仍计入今日盈亏。没有变更日志则用当前股数。
- 没有今日会话日（含休市）：总览「证券今日」和证券 KPI / 明细一律 **—**，不要渲染 `¥0.00`。

价格 sparkline：`listStockPriceHistory` 合并 `stock_price_daily`（优先）与 `asset_change` 里对 `current_price` 的修改。

总览新鲜度：`app/_components/DataFreshness.tsx`，数据来自上次成功时间和两枚 `last_*_refresh_error`。过期判定复用 `shouldRefreshFxEvery8h` / `shouldRefreshStocksBy10And14`，不要在页面里再写一套。

---

## 自动刷新怎么触发

两条路径，都调用 `refreshRates(false)` / `refreshStockPrices({ force: false })`，因此 8h / 10–14 点规则仍然生效：

1. `app/layout.tsx` 加载时 `startAutoRefreshScheduler()`，每 60s 一轮（`lib/autoRefresh.ts`），HMR 下靠 `globalThis` 防重复。
2. 总览 / 资产 / 证券 / 设置 SSR 里 `kickoff*`，不阻塞首屏。

不要再叠一套「每天 10:00 cron」。不要在客户端轮询聚合接口。

---

## 证券交易

详情页 `TradeDialog`：

- 增持 / 减持 → `POST /api/assets/[id]/trade`（更新份额与均价）。
- 清仓 → `POST /api/assets/[id]/liquidate`（**删除**该资产行）。
- 可选 `cash_asset_id`：必须是 `cash` 大类、同币种。买入扣款、卖出/清仓加款。不选则只改证券、不动现金。
- 新建证券也可在 `POST /api/assets` 带 `cash_asset_id`，按 `quantity × unit_cost` 扣现金。

改仓必须走这些 API（或至少写 `asset_change`），否则今日盈亏的日初股数还原会失败。

---

## 快照

`ensureTodaySnapshot(baseCurrency)`：当天该基准货币一条，存在则更新净值。进程内 30s 节流，避免 SSR/HMR 把 SQLite fsync 打满。资产变更成功后也要调。不要每请求无节流地 `INSERT`。

---

## 建议规则（`lib/advisor.ts`）

分母是总资产（净资产 + 负债）。当前阈值：

- 现金 > 30% → warn
- 任一大类（除负债）> 60% → warn
- 加密货币 > 20% → danger
- 30 天内到期 → info
- 无外币且净资产超过 50 万 CNY / 7 万 USD → info
- 负债率 > 50% → danger；> 30% → warn
- 现金+存款 < 负债 × 10% → warn
- 净资产 < 0 → danger

改阈值只改这一处。

---

## UI / API 习惯

- 导航：总览 / 资产 / 证券 / 历史 / 设置。点当前项会 `router.refresh()`。
- 主题：`class` + cookie `theme`；`gain`/`loss`/`gold`/`ink`/`canvas` 见 `app/globals.css`。
- 资产列表 `?cat=` 用 `lib/assetsNav.ts` 回跳，不要把用户丢回「全部」。
- 证券搜索：`GET /api/securities/search?q=`，东方财富 suggest，服务端 `undici`。
- 一次性回填空 `symbol`：`scripts/backfill_symbols.mjs`（需 dev server）。

---

## 排查

价格/汇率没变时按这个顺序，不要先改节奏代码：

1. 设置页两枚 Key 是否 configured；股票产品是否开通。总览是否已提示过期/失败。
2. 是否周末（自动会跳过；手动仍可拉），或未到 10:00，或上午档已拉过、未到 14:00。
3. `symbol` 能否被 `parseStockSymbol` 识别。
4. 终端是否 `ENOTFOUND`（Fake-IP）或聚合 `error_code`（Key/额度）。总览会显示上次错误。
5. 设置页股票失败日志（`stock_refresh_log`）。

改刷新逻辑时：汇率只动 `shouldRefreshFxEvery8h`；股票只动 `shouldRefreshStocksBy10And14` / `isWeekendBeijing`。不要在页面里再写一套时间判断。

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
| `asset` | 明细。证券用 `quantity` + `unit_cost` + `current_price` + `symbol`；多数其它类型用 `amount`。`change_*` 只服务证券行情会话日盈亏。 |
| `fx_rate` | 汇率缓存。`source`：`juhe` 或 `manual`。旧 `frankfurter` 下次成功刷新会被覆盖。 |
| `fx_rate_history` | 每个币对每个整点最终生效的汇率观测；自动和手动汇率都会写入 |
| `setting` | 键值：`base_currency`、两枚 AppKey、`last_stocks_refresh_at`、`last_fx_refresh_error`、`last_stocks_refresh_error` |
| `asset_change` | create / update / delete；update 的 `field_changes` 为 JSON diff |
| `portfolio_event` | 统一业务事件头：入金、消费、买卖、分红、清仓、资产增删、手动校准 |
| `portfolio_event_leg` | 同一事件涉及的资产腿；用带符号金额/份额把证券和现金关联起来 |
| `portfolio_snapshot` | 每日净资产快照，`UNIQUE(date, base_currency)`，写入即覆盖当天 |
| `asset_valuation_daily` | 每日逐资产估值；固化原币价值、当时汇率、基准币价值与价格/成本字段 |
| `stock_refresh_log` | 每次单股请求一条，约 30 天清理；不进 JSON 备份 |
| `stock_price_daily` | 每标的每个**行情会话日**一条价格，供盈亏走势；在 JSON 备份里 |

`change_quote_date`：沪深/港股从接口 `date`（优先）或 `time` 解析；美股从 `ustime` 取交易月日、用 `chtime` 推断年份。解析不到就写 **null**，禁止回落成 `todayCn()`。空日期不计入行情会话日盈亏。`change_updated_at` 是历史列，判定**不要再用它**。不要在 `migrateSchema` 里把 null 日期再填回去。

JSON 备份（`app/api/backup`）`version: 5` 导出：category / account / asset / fx_rate / **fx_rate_history** / setting / asset_change / portfolio_event / portfolio_event_leg / portfolio_snapshot / **asset_valuation_daily** / stock_price_daily / **entity_id_sequence** / **history_integrity**。不含 `stock_refresh_log`。覆盖模式会先删除事件腿、事件头、估值历史、汇率历史、日线、刷新日志和上述业务表（分类、身份高水位和覆盖元数据除外）再导入。旧版备份缺事件表、估值/汇率历史或 `stock_price_daily` 仍可导入；旧备份里的 `fx_rate` 会精确补成一个历史观测点。

`portfolio_event` 从功能上线后开始可靠记录。旧 `asset_change` 无法确定多资产记录是否属于同一笔操作，禁止猜测关联或自动回填。业务 API 必须在更新资产的**同一个 SQLite 事务**里调用 `recordPortfolioEvent`；通过 `lib/portfolioMutations.ts` 的 `portfolioTransaction` 同时提交当天快照，快照失败必须回滚业务。账户删除/分类调整也要逐资产留痕。自动行情刷新不写业务事件。

新增资产/账户必须在业务事务内经 `lib/identity.ts` 的 `allocateEntityId` 分配 ID；`entity_id_sequence` 高水位覆盖当前与历史引用，禁止随删除或覆盖导入清空/降低，不破坏性重建旧表。不能自动修复已有疑似身份冲突。导入后同步高水位并重置 `history_integrity` 的可靠记录起点；首条事件不代表覆盖完整，系统记录覆盖也不证明现实操作全已录入。

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
- 每次汇率写入必须同时更新 `fx_rate` 和 `fx_rate_history`；同一整点重复写以最后值为准。只读历史接口是 `GET /api/fx/history`。
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

`GET /api/stocks?refresh=1` 为强制（周末也会打接口）；可传 `market=hs|hk|us` 只刷新单一市场，单市场刷新不得推进全局 `last_stocks_refresh_at`。`maxDuration = 300`。

### 行情会话日盈亏

以 `computeTodayStockPnL`（`lib/history.ts`）为准。

规则：

- 沪深/港股仅 `change_quote_date === todayCn()` 的标的进入汇总；美股取当前持仓中最新的有效 `change_quote_date`，并在 UI 明示该交易日。空日期不计入，不同美股交易日禁止混算。
- 单价涨跌用落库的 `change_amount` / `change_percent`。
- 股数用 `mapSecurityQuantityBeforeFirstEditToday`：从今日 `asset_change` 的 `quantity` diff 反推日初股数。当天减仓/清仓，已卖部分仍计入今日盈亏。已删除证券由当日删除日志的分类/行情快照补入候选；缺分类依据的旧日志不猜测。没有变更日志则用当前股数。
- 没有可用会话日（含休市）：`availableTotalBase = null`，缺汇率不按 0 计入；`status` 区分 complete / partial / unavailable。总览「证券当日」和证券 KPI / 明细一律 **—**，不要渲染 `¥0.00`。

`listSnapshots` 的数量参数表示最近 N 个观测点（返回日期正序）；`GET /api/history` 支持 from/to 区间及汇总，证券市值曲线保留清仓后的零值。

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

## 现金流

现金资产详情页 `CashFlowPanel` 提供入金 / 消费，调用 `POST /api/assets/[id]/cash-flow`：

- 金额必须大于 0，原因必填；消费不可超过当前现金余额。
- 更新余额与写日志在同一事务内完成，并刷新当日快照。
- 记录复用 `asset_change`：除 `amount` diff 外，`field_changes` 还写入 `cash_flow_type`、带方向的 `cash_flow_amount` 和 `cash_flow_reason`。`listCashFlowEntries` 用它们还原现金流列表。
- 同一事务还要写 `portfolio_event` 的 `cash_deposit` / `cash_expense` 与现金资产腿，供报表统一统计。

---

## 快照

`recordSnapshot(baseCurrency)` 的 `created_at` 随覆盖更新为最近采集时点，同一事务更新 `portfolio_snapshot`，并重写当天同基准币的 `asset_valuation_daily`，已删除资产不会残留在当天明细。`ensureTodaySnapshot(baseCurrency)` 带进程内 30s 节流，避免 SSR/HMR 把 SQLite fsync 打满；它只用于页面读取；业务变更通过 `portfolioTransaction` 在同一事务内调用 `recordSnapshot`，禁止使用节流写入。汇率或股票行情实际更新成功后直接调用 `recordSnapshot`，确保估值历史使用新价格/汇率。

`GET /api/valuation-history` 是逐资产估值只读接口；同时传 `from` / `to` 会返回 `summarizeFxImpact` 的汇率归因与两端数据覆盖标记。归因使用对称分解：平均原币敞口 × 汇率变化；新出现/消失的币种、缺失汇率和只有旧版总快照而没有逐资产明细的差额都放入 `unclassifiedBaseValueChange`，不要猜测或反推旧日明细。

总览与净值曲线的变化明细共用 `lib/netWorthHistory.ts` / `lib/netWorthChange.ts`。优先较昨日，缺昨日时标注上次快照日期；入金等原币项目按两端平均汇率折算，与对称汇率分解对账。证券盈亏用端点市值减去成交本金变动（含清仓），不要用行情会话日盈亏替代；未关联现金的本金变动单列。事件读取不得分页截断，可靠事件记录之前的证券变化、缺估值/汇率等差额保留未归因，不反推利息。新手动校准事件需在 metadata 保留原币估值、分类与币种的 before/after，供归因使用。验证：`node scripts/test-net-worth-change.cjs`。

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

## 本地 AI 助手

- Ollama 默认地址 `http://127.0.0.1:11434`，默认模型 `qwen3.5:latest`；只能经 `OLLAMA_BASE_URL` / `OLLAMA_MODEL` 等环境变量覆盖，不要把远端服务或凭证写死。
- `POST /api/ai` 只接受当前 `action` 与当前问题，不接受历史消息。每次请求由 `lib/ai/context.ts` 重新生成最新只读资产上下文；禁止把浏览器聊天历史发给模型。
- AI 上下文不得包含 `setting` 中的 AppKey、资产备注或其它凭证。模型没有写库工具；不要从 AI 路由调用资产写 API、`recordPortfolioEvent`、`recordSnapshot` 或 setting 写方法。
- Ollama 输出由 API 转成纯文本流。前端历史只存在 `localStorage`，清空对话不得动 SQLite。
- 事件层和逐资产估值覆盖之前的数据缺口必须原样告诉模型，禁止反推旧历史。程序先计算净值、比例、事件和汇率归因，模型只负责解释。
- 历史区间由 `lib/analysisPeriod.ts` 解析、`lib/analytics.ts` 统一计算实际快照端点；过去区间不得混用当前估值。常见日期可直接问，模糊/多区间表达返回澄清。
- 事件汇总不受明细分页限制；现金流用业务时点之前的历史汇率，缺失返回 null。JSON 上下文保留 null，不把缺数据解释成 0。
- 收益维持用户录入的券商均价口径，不另建独立真实收益账。分红可能已调整成本，禁止将分红再次直接加到浮盈；费用、税费、未关联现金的完整性必须说明。

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

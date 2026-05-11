# Asset Manager — Project Agent Notes

本文件是写给后续 AI agent 和本项目开发者的长期备忘，描述一些非直觉但**必须遵守**的约定。

## 运行环境

- macOS 本机开发。
- 本机长期运行着 **Clash/ClashX/Mihomo 类 VPN 代理（Fake-IP 模式）**，HTTP 代理监听在 `127.0.0.1:7890`。
- Node 原生 `fetch` (undici) **默认不走系统代理**，在 Fake-IP 模式下会直接 `ENOTFOUND`，因此涉及访问公网的服务端调用必须通过代理。

## 时区

- 程序统一使用中国时区（`Asia/Shanghai`, UTC+8）。
- `next.config.mjs` 和 `lib/db.ts` 会设置 `process.env.TZ`。
- 写入数据库的新时间戳由 `lib/time.ts` 的 `nowCn()` / `todayCn()` 产出，格式 `YYYY-MM-DDTHH:MM:SS+08:00`。
- 展示时间统一走 `formatCnDateTime` / `formatCnDate`，会兼容老的 UTC 字符串并按北京时区渲染。
- 不要再写 `new Date().toISOString()` 存 DB，也不要再用 `CURRENT_TIMESTAMP` 作为 DEFAULT（新建表除外，且必须使用 `lib/schema.sql` 里 `strftime(...,'+8 hours') || '+08:00'` 的默认值写法）。

## 聚合数据 AppKey（绝不在代码中写死）

- **设置页**「聚合数据 AppKey」卡片可分别保存到 SQLite `setting` 表：`juhe_fx_appkey`（全球汇率）与 `juhe_stock_appkey`（股票数据，ID=21）。
- **读 Key 的优先级**（`lib/juheKeys.ts`）：数据库保存的值 **优先于** 环境变量；环境变量为 `JUHE_FX_APPKEY` / `JUHE_STOCK_APPKEY`，供部署时注入、不进仓库。

## 汇率服务（聚合数据）

- 接口：`http://op.juhe.cn/onebox/exchange/currency`（`lib/fx.ts`）
- 支持货币仅 `CNY / USD / HKD`（`lib/currencies.ts`）。
- 自动刷新：距「上次非手动的 `fetched_at`」**满 8 小时**再拉取（`lib/time.ts:shouldRefreshFxEvery8h` / `nextFxAutoRefreshIso`）。访问 Dashboard / 设置等页会 `ensureRates()` 触发判断。
- 每次完整刷新为 3 次 API 请求（3 个币对组合）。

## 股票价格服务（聚合数据「股票数据」）

- 与汇率 **AppKey 分开配置**；股票端点（`lib/stocks.ts:JUHE_STOCK_ENDPOINT`）：
  - 沪深：`https://web.juhe.cn/finance/stock/hs?gid=sh600519`
  - 港股：`https://web.juhe.cn/finance/stock/hk?num=00700`
  - 美股：`https://web.juhe.cn/finance/stock/usa?gid=aapl`
- 解析股票代码的规则全部放在 `parseStockSymbol`，支持 `SH600519` / `600519` / `HK00700` / `00700` / `AAPL` 等；资产表单（`AssetForm`）会把用户输入自动大写并保存到 `asset.symbol`。
- 接口调用复用 `lib/net.ts:getProxyDispatcher`，走同一 `127.0.0.1:7890` 代理。
- API：`GET /api/stocks` 返回当前证券列表与下一次计划时间；`GET /api/stocks?refresh=1` 会强制刷新所有持仓股的 `current_price`（UI 在「设置 → 股票价格」页有按钮）。
- **时间戳**：`lib/time.ts` 的 `nowCn()` / `toCnIso()` 精度到**北京时间整点小时**（`…T14:00:00+08:00`），不写分秒毫秒级差异；展示用 `formatCnDateTime` 与之对齐。
- **周六日**：`isWeekendBeijing(todayCn())` 为真时，`refreshStockPrices` **直接返回** `skipped: "weekend"`，**不调 Juhe**；总览 / 证券页「今日」相关为 **—**，设置里手动刷新禁用。
- **今日盈亏**：`computeTodayStockPnL` 仅用落库的 `change_amount` / `change_percent`（不再按 `change_quote_date` 过滤）。`change_quote_date` 仍写入接口解析的会话日，仅作记录。
- **额度 / 单条失败**：`refreshStockPrices` 里**失败的分支不写 `UPDATE`**，不会把其它标的已有涨跌清空；已去掉「fatal 后整批跳过」逻辑，额度耗尽后**后续标的仍会各请求一次**（可能仍失败，但不影响已成功写入的行）。

## 拉取节奏小结

- **汇率**：每 **8 小时**一条自动周期；上次拉取见 `fx_rate` 表中 `source != 'manual'` 的 `fetched_at` 最大值。设置页点「刷新」会带 `?refresh=1` 为强制。
- **股票**：以北京时间 **10:00** 与 **14:00** 为日锚点，一天最多自动补两次（`latestPassedCnStockAnchorMs` / `shouldRefreshStocksBy10And14` / `nextStockAutoRefreshIso`），上次成功尝试见 `last_stocks_refresh_at`。未到当日 10:00 不自动拉。
- 页面加载时常用：`kickoffRatesRefresh()` + `kickoffStockPricesRefresh()` 后台触发（不阻塞 SSR 首屏）；汇率侧另有 `ensureRates()` 等路径，见 `lib/fx.ts` / 各 `page.tsx`。

### 如果数据没变

1. **先查设置**：两枚 AppKey 是否已配置；股票产品是否已在聚合数据控制台开通；代理是否如 fx-dev-proxy 说明开启。
2. 股票在 **10:00 前**或 **10:00～14:00 且已拉过 10:00 那一档、未到 14:00** 等情况下，可能属于预期跳过，可用「手动刷新」验证。
3. 证券没填或无法解析的 `symbol` 会被跳过，列表会有提示。

### 必须走 HTTP 代理

聚合接口调用通过 `undici.fetch + ProxyAgent` 实现，代理地址按优先级读取：

```
FX_PROXY > HTTPS_PROXY > HTTP_PROXY > ALL_PROXY  （大小写都兼容）
```

若未配置代理，在本机 Fake-IP 环境下 DNS 会解析到 `198.18.x.x`，Node 进程将直接 `ENOTFOUND`。dev server 日志里第一次发起汇率请求时会打印：

```
[fx] using HTTP proxy for juhe: http://127.0.0.1:7890
```

## 启动/重启服务

默认脚本已预置代理端口 `7890`，常规启动直接：

```bash
npm run dev
```

等同于 `FX_PROXY=http://127.0.0.1:7890 next dev ...`。如果：

- 代理端口不是 7890：`FX_PROXY=http://127.0.0.1:<port> npm run dev`
- 临时不走代理（调试或代理未开）：`npm run dev:noproxy`
- 生产启动同理：`npm run start`

**不要**自己去 `kill` + 重启时忘了带代理。若看到刷新汇率报 `无法连接汇率服务（fetch failed | ENOTFOUND ...）`，几乎都是代理没生效。

## 数据库

- SQLite 文件：`data/assets.db`（启动时自动初始化）。
- Schema：`lib/schema.sql`（`CREATE TABLE IF NOT EXISTS`，已有库不会重建）。
- 历史资料：旧的 UTC 时间戳不做迁移，由展示层兼容；旧的 `source=frankfurter` 汇率记录会在下次 `/api/fx?refresh=1` 时被 `juhe` 覆盖。


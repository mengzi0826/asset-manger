/**
 * 统一的时间/时区处理（中国时区 Asia/Shanghai, UTC+8）。
 *
 * 写入数据库的新时间戳统一使用 `nowCn()`（带 `+08:00` 偏移的 ISO 字符串），
 * 读取展示统一走 `formatCnDateTime` / `formatCnDate`，
 * 兼容旧数据（SQLite `CURRENT_TIMESTAMP` 产出的 `YYYY-MM-DD HH:MM:SS` UTC 字符串）。
 */

export const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toCnIso(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date(d.getTime() + CN_TZ_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+08:00`
  );
}

/** 当前时刻的北京时间 ISO，如 `2026-04-22T11:51:04+08:00` */
export function nowCn(): string {
  return toCnIso(new Date());
}

/** 北京时区下的 `YYYY-MM-DD` */
export function todayCn(): string {
  return nowCn().slice(0, 10);
}

/**
 * 宽松解析数据库里的时间字符串。
 * - 形如 `YYYY-MM-DD HH:MM:SS` 或 `YYYY-MM-DDTHH:MM:SS`（无时区）→ 按 UTC 解析
 *   （SQLite `CURRENT_TIMESTAMP` 历史数据）。
 * - 其余（带 `Z` / `+08:00` / 其他）→ 交给原生 Date 解析。
 */
export function parseDbDate(s: string): Date {
  const str = s.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
    return new Date(str.replace(" ", "T") + "Z");
  }
  return new Date(str);
}

/** 统一展示成北京时间 `YYYY-MM-DD HH:mm:ss` */
export function formatCnDateTime(s?: string | null): string {
  if (!s) return "-";
  const d = parseDbDate(s);
  if (Number.isNaN(d.getTime())) return s;
  return toCnIso(d).slice(0, 19).replace("T", " ");
}

/** 汇率：距上次非手动拉取满 8 小时再刷新 */
export const FX_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;

/** 股票：北京时间每日 10:00 与 14:00 各可触发一次自动刷新 */
export const STOCK_REFRESH_HOURS_BEIJING: readonly [number, number] = [10, 14];

/**
 * 今天北京时间的某整点/整分，转为绝对时间戳（毫秒）。
 * 如 hour=10, minute=0 表示今天北京时间 10:00。
 */
export function cnTimeTodayToMs(hour: number, minute: number = 0): number {
  return new Date(
    `${todayCn()}T${pad(hour)}:${pad(minute)}:00+08:00`
  ).getTime();
}

/**
 * 当前时刻之前、当天已触发的「股票日级锚点」中最近的一个；早于今天 10:00 则 null。
 * 如 11:00 → 10:00；16:00 → 14:00；9:00 → null。
 */
export function latestPassedCnStockAnchorMs(): number | null {
  const now = Date.now();
  let best: number | null = null;
  for (const h of STOCK_REFRESH_HOURS_BEIJING) {
    const a = cnTimeTodayToMs(h, 0);
    if (a <= now && (best == null || a > best)) best = a;
  }
  return best;
}

/**
 * 股票：在 10:00/14:00 两个锚点，若 `last` 早于「当前应满足的最近锚点」则需拉取一次。
 */
export function shouldRefreshStocksBy10And14(
  lastIso: string | null | undefined
): boolean {
  const anchor = latestPassedCnStockAnchorMs();
  if (anchor == null) return false; // 未到今日 10:00，不自动拉
  const last = lastIso ? parseDbDate(lastIso).getTime() : 0;
  if (!Number.isFinite(last)) return true;
  return last < anchor;
}

/** 下一次股票自动触发的计划时间（北京时间 ISO） */
export function nextStockAutoRefreshIso(): string {
  const now = Date.now();
  const t10 = cnTimeTodayToMs(STOCK_REFRESH_HOURS_BEIJING[0], 0);
  const t14 = cnTimeTodayToMs(STOCK_REFRESH_HOURS_BEIJING[1], 0);
  if (now < t10) return toCnIso(new Date(t10));
  if (now < t14) return toCnIso(new Date(t14));
  // 明日 10:00
  const tNext10 = t10 + 24 * 60 * 60 * 1000;
  return toCnIso(new Date(tNext10));
}

/** 汇率：距 `last` 是否已满 8 小时；无记录视为需要刷新。 */
export function shouldRefreshFxEvery8h(lastIso: string | null | undefined): boolean {
  if (!lastIso) return true;
  const t = parseDbDate(lastIso).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= FX_REFRESH_INTERVAL_MS;
}

/** 汇率：下次应自动拉取时间（不早于「现在」+8h 的推算） */
export function nextFxAutoRefreshIso(lastIso: string | null | undefined): string {
  if (!lastIso) return toCnIso(new Date());
  const t = parseDbDate(lastIso).getTime();
  if (!Number.isFinite(t)) return toCnIso(new Date());
  return toCnIso(new Date(t + FX_REFRESH_INTERVAL_MS));
}

/** 统一展示成北京时区下的 `YYYY-MM-DD` */
export function formatCnDate(s?: string | null): string {
  if (!s) return "-";
  const trimmed = s.trim();
  // 纯日期直接返回，不需要解析（避免被当成 UTC 后偏移一天）
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = parseDbDate(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  return toCnIso(d).slice(0, 10);
}

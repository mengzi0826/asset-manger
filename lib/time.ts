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

/** 北京时间 ISO，精度到「整点小时」（分、秒恒为 00），不写毫秒 */
export function toCnIso(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date(d.getTime() + CN_TZ_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}:00:00+08:00`
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

/** 美股会话日仅在同名北京日及次日展示；次日结束后不再作为当日盈亏。 */
export function isUsQuoteDateInDisplayWindow(
  quoteDate: string | null | undefined,
  today: string = todayCn()
): boolean {
  if (!quoteDate) return false;
  const yesterday = toCnIso(
    new Date(new Date(`${today}T00:00:00+08:00`).getTime() - 24 * 60 * 60 * 1000)
  ).slice(0, 10);
  return quoteDate === today || quoteDate === yesterday;
}

/** 该北京日历日是否为周六 / 周日（按 UTC 日期分量解释 ymd） */
export function isWeekendBeijing(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * 解析聚合数据股票接口 `data.time` 为北京时区下的 `YYYY-MM-DD`。
 * 常见：`2026-04-29 15:00:00`、纯数字 Unix 秒/毫秒；用于判断「涨跌额」是否属于**今天**的行情会话。
 * 解析失败返回 null（调用方按「无行情日期」处理）。
 */
export function parseJuheDataTimeToBeijingYmd(
  raw: string | number | undefined | null
): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return toCnIso(new Date(ms)).slice(0, 10);
  }
  const s = String(raw).trim();
  const head = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (head) return head[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toCnIso(d).slice(0, 10);
  return null;
}

/**
 * 常见行情 `date` 字串：`2026-05-09`、`2026/5/9`、`20260509`、前缀日期后接时间等。
 * 返回北京日历 `YYYY-MM-DD`，失败 null。
 */
export function parseLooseCalendarYmdToBeijing(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const slashOrDash = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (slashOrDash) {
    const y = slashOrDash[1];
    const mo = pad(Number(slashOrDash[2]));
    const d = pad(Number(slashOrDash[3]));
    return `${y}-${mo}-${d}`;
  }
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})\b/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const head = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (head) return head[1];
  const du = new Date(s);
  if (!Number.isNaN(du.getTime())) return toCnIso(du).slice(0, 10);
  return null;
}

const EN_MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function validCalendarYmd(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * 聚合美股接口没有 `date` / `time`，交易会话时间放在 `ustime`，例如
 * `Mar 11 4:00PM EDT`；年份从同时返回的北京时间 `chtime` 推断。
 */
function parseJuheUsSessionYmd(data: Record<string, unknown>): string | null {
  const raw = String(data.ustime ?? "").trim();
  if (!raw) return null;

  // 兼容接口未来直接返回完整年月日的情况。
  const fullYmd = parseLooseCalendarYmdToBeijing(raw);
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw) && fullYmd) return fullYmd;

  const match = raw.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i
  );
  if (!match) return null;
  const month = EN_MONTH_INDEX[match[1].toLowerCase()];
  const day = Number(match[2]);
  const explicitYear = match[3] ? Number(match[3]) : null;
  if (explicitYear != null) return validCalendarYmd(explicitYear, month, day);

  const chinaYmd = parseLooseCalendarYmdToBeijing(String(data.chtime ?? ""));
  const referenceYmd = chinaYmd ?? todayCn();
  const [referenceYear, referenceMonth, referenceDay] = referenceYmd.split("-").map(Number);
  const referenceMs = Date.UTC(referenceYear, referenceMonth - 1, referenceDay);

  // 跨年时北京时间可能已是 1 月 1 日，而美股会话仍是上一年 12 月 31 日。
  // 在参考年份前后各取一年，选择离北京时间日期最近的合法日历日。
  let best: { ymd: string; distance: number } | null = null;
  for (const year of [referenceYear - 1, referenceYear, referenceYear + 1]) {
    const ymd = validCalendarYmd(year, month, day);
    if (!ymd) continue;
    const distance = Math.abs(Date.UTC(year, month - 1, day) - referenceMs);
    if (!best || distance < best.distance) best = { ymd, distance };
  }
  return best?.ymd ?? null;
}

/**
 * Juhe 股票 data 体：优先 `date`（通常为**交易日**），其次解析 `time`；
 * 美股接口改读 `ustime`，并用 `chtime` 推断年份。
 */
export function juheQuoteSessionYmdFromData(data: Record<string, unknown>): string | null {
  const rawDate = data.date;
  if (rawDate != null && rawDate !== "") {
    if (typeof rawDate === "number" && Number.isFinite(rawDate)) {
      const n = rawDate;
      // 聚合常把交易日写成整数 20260509，若当毫秒解析会错到 1970 年
      if (Number.isInteger(n) && n >= 19700101 && n <= 21001231) {
        const y = Math.floor(n / 10000);
        const mo = Math.floor((n % 10000) / 100);
        const d = n % 100;
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          return `${y}-${pad(mo)}-${pad(d)}`;
        }
      }
      const ms = n < 1e12 ? n * 1000 : n;
      return toCnIso(new Date(ms)).slice(0, 10);
    }
    const fromStr = parseLooseCalendarYmdToBeijing(String(rawDate));
    if (fromStr) return fromStr;
  }
  const fromTime = parseJuheDataTimeToBeijingYmd(
    data.time as string | number | undefined | null
  );
  return fromTime ?? parseJuheUsSessionYmd(data);
}

/**
 * 腾讯行情字段里的时间，取字符串上的日历日作为行情会话日，不做时区换算。
 * 沪深常见 `20261020161450`，港股 `2026/10/20 16:08:24`，美股 `2026-10-19 16:00:01`（美东当地日期）。
 */
export function parseTencentQuoteTimeToSessionYmd(
  raw: string | number | undefined | null
): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})\d{6}$/);
  if (compact) {
    return validCalendarYmd(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  }
  return parseLooseCalendarYmdToBeijing(s);
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

/** 统一展示成北京时间 `YYYY-MM-DD HH:00`（与存库粒度一致，不展示分秒） */
export function formatCnDateTime(s?: string | null): string {
  if (!s) return "-";
  const d = parseDbDate(s);
  if (Number.isNaN(d.getTime())) return s;
  return toCnIso(d).slice(0, 16).replace("T", " ");
}

/** 北京时间 ISO，精度到分钟（秒恒为 00）。只给需要亚小时节流的水位用。 */
export function toCnIsoMinute(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date(d.getTime() + CN_TZ_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00+08:00`
  );
}

export function nowCnMinute(): string {
  return toCnIsoMinute(new Date());
}

/** 展示北京时间到分钟，用于股价刷新水位。 */
export function formatCnDateTimeMinute(s?: string | null): string {
  if (!s) return "-";
  const d = parseDbDate(s);
  if (Number.isNaN(d.getTime())) return s;
  return toCnIsoMinute(d).slice(0, 16).replace("T", " ");
}

/** 汇率：距上次非手动拉取满 8 小时再刷新 */
export const FX_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;

/** 股票：任一市场开市期间，距上次实际请求满 15 分钟再自动拉一批 */
export const STOCK_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const STOCK_SESSION_LOOKAHEAD_MINUTES = 4 * 24 * 60;

function zonedWeekdayAndMinutes(date: Date, timeZone: string): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = fmt.formatToParts(date);
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "";
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekdayName] ?? 0;
  let hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (hour === 24) hour = 0;
  return { weekday, minutes: hour * 60 + minute };
}

function inSessionWindow(minutes: number, start: number, end: number): boolean {
  return minutes >= start && minutes < end;
}

/** 沪深连续竞价：工作日 9:30–11:30、13:00–15:00（北京时间） */
export function isHsMarketOpen(now: Date = new Date()): boolean {
  const { weekday, minutes } = zonedWeekdayAndMinutes(now, "Asia/Shanghai");
  if (weekday === 0 || weekday === 6) return false;
  return (
    inSessionWindow(minutes, 9 * 60 + 30, 11 * 60 + 30) ||
    inSessionWindow(minutes, 13 * 60, 15 * 60)
  );
}

/** 港股持续交易：工作日 9:30–12:00、13:00–16:00（香港与北京同时区） */
export function isHkMarketOpen(now: Date = new Date()): boolean {
  const { weekday, minutes } = zonedWeekdayAndMinutes(now, "Asia/Shanghai");
  if (weekday === 0 || weekday === 6) return false;
  return (
    inSessionWindow(minutes, 9 * 60 + 30, 12 * 60) ||
    inSessionWindow(minutes, 13 * 60, 16 * 60)
  );
}

/** 美股常规交易：美东工作日 9:30–16:00，夏令时/冬令时由 America/New_York 决定 */
export function isUsMarketOpen(now: Date = new Date()): boolean {
  const { weekday, minutes } = zonedWeekdayAndMinutes(now, "America/New_York");
  if (weekday === 0 || weekday === 6) return false;
  return inSessionWindow(minutes, 9 * 60 + 30, 16 * 60);
}

export function isAnyStockMarketOpen(now: Date = new Date()): boolean {
  return isHsMarketOpen(now) || isHkMarketOpen(now) || isUsMarketOpen(now);
}

/** 从当前时刻往后找下一分钟级开市点；已开市则返回 now。 */
export function nextStockMarketOpen(now: Date = new Date()): Date {
  if (isAnyStockMarketOpen(now)) return now;
  const start = now.getTime();
  for (let i = 1; i <= STOCK_SESSION_LOOKAHEAD_MINUTES; i++) {
    const t = new Date(start + i * 60 * 1000);
    if (isAnyStockMarketOpen(t)) return t;
  }
  return new Date(start + 60 * 1000);
}

/**
 * 自动刷新：当前有市场开着，且距上次水位已满 15 分钟。休市返回 false。
 */
export function shouldRefreshStocks(
  lastIso: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!isAnyStockMarketOpen(now)) return false;
  if (!lastIso) return true;
  const last = parseDbDate(lastIso).getTime();
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= STOCK_REFRESH_INTERVAL_MS;
}

/** 下一次股票自动触发时间（北京时间，精度到分钟） */
export function nextStockAutoRefreshIso(
  lastIso?: string | null,
  now: Date = new Date()
): string {
  if (isAnyStockMarketOpen(now)) {
    const last = lastIso ? parseDbDate(lastIso).getTime() : NaN;
    if (Number.isFinite(last)) {
      const due = last + STOCK_REFRESH_INTERVAL_MS;
      if (due > now.getTime()) return toCnIsoMinute(new Date(due));
    }
    return toCnIsoMinute(now);
  }
  return toCnIsoMinute(nextStockMarketOpen(now));
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

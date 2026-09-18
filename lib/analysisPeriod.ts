import { addDays, endOfMonth, endOfWeek, endOfYear, format, isValid, parseISO, startOfMonth, startOfWeek, startOfYear, subDays, subMonths, subYears } from "date-fns";
import type { AiAction } from "./ai/types";

export function isCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value)) && format(parseISO(value), "yyyy-MM-dd") === value;
}

/** 时间数量支持阿拉伯数字和中文数字；只在时间表达内转换，不改资产名称。 */
function parsePeriodCount(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  if ([...raw].every(char => char in digits)) {
    return Number([...raw].map(char => digits[char]).join(""));
  }
  let total = 0;
  let pending: number | null = null;
  let previousUnit = Infinity;
  for (const char of raw) {
    if (char in digits) {
      if (pending != null && pending !== 0) return null;
      pending = digits[char];
    } else {
      const unit = units[char];
      if (!unit || unit >= previousUnit || pending === 0) return null;
      total += (pending ?? 1) * unit;
      pending = null;
      previousUnit = unit;
    }
  }
  return total + (pending ?? 0);
}

/** 明确支持的日期表达由程序解析；模糊/多区间问题要求澄清，不冒充已查询。 */
export function resolveAnalysisPeriod(action: AiAction, today: string, question = "") {
  question = question.normalize("NFKC");
  const date = parseISO(today);
  const ymd = (d: Date) => format(d, "yyyy-MM-dd");
  const make = (from: Date, to: Date, label: string, clarification: string | null = null) => ({
    from: ymd(from), to: ymd(to), label, clarification
  });
  const fallback = () => make(subDays(date, 29), date, "近 30 日");
  const clarify = (message: string) => ({ ...fallback(), clarification: message });
  if (action === "brief_daily") return make(date, date, "今日");
  if (action === "brief_weekly") return make(subDays(date, 6), date, "近 7 日");
  if (action === "brief_monthly") return make(startOfMonth(date), date, "本月至今");
  if (action === "checkup") return make(subDays(date, 89), date, "近 90 日");

  const impliedYear = Number(today.slice(0, 4)) - (/前年/.test(question) ? 2 : /去年/.test(question) ? 1 : 0);
  question = question.replace(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)/g,
    (_, year, month, day) => `${year ?? impliedYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
  const dates = question.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (dates.length) {
    if (dates.length > 2 || dates.some(d => !isCalendarDate(d))) return clarify("请提供一组有效的起止日期（YYYY-MM-DD）。");
    const from = dates[0]!;
    const to = dates[1] ?? (/以来|至今|到现在/.test(question) ? today : from);
    if (from > to || to > today) return clarify("查询起点必须不晚于终点，且不能查询未来日期。");
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 3650) return clarify("单次区间最多 3650 天，请分段查询。");
    return make(parseISO(from), parseISO(to), `${from} 至 ${to}`);
  }
  if (/(季度|半年|同比|环比)/.test(question) ||
      (/(对比|相比|比较)/.test(question) && /(月|年|周|昨天|今天|日期)/.test(question)) ||
      (question.match(/上个?月|本月|这个月|去年|今年|上周|本周/g) ?? []).length > 1) {
    return clarify("请明确要查询的起止日期；多个期间需要分别查询后比较。");
  }
  const recent = question.match(/(?:最近|过去|近)\s*(\d+|[零〇一二两三四五六七八九十百千]+)\s*(?:个\s*)?(天|日|星期|周|月|年)/);
  if (recent) {
    if (/^\s*半/.test(question.slice(recent.index! + recent[0].length))) {
      return clarify("请用具体起止日期说明包含半个月或半周的时间范围。");
    }
    const n = parsePeriodCount(recent[1]);
    if (n == null || !Number.isSafeInteger(n) || n < 1 || n > 3650) return clarify("请提供有效的查询数量或起止日期。");
    const unit = recent[2];
    const from = unit === "年" ? addDays(subYears(date, n), 1)
      : unit === "月" ? addDays(subMonths(date, n), 1)
      : subDays(date, n * (unit === "周" || unit === "星期" ? 7 : 1) - 1);
    if ((date.getTime() - from.getTime()) / 86400000 > 3650) return clarify("单次区间最多 3650 天，请分段查询。");
    return make(from, date, recent[0]);
  }
  if (/(?:最近|过去|近)\s*[^，。！？、；：\n]{0,12}(?:天|日|周|星期|月|年)/.test(question)) {
    return clarify("没有识别出明确的时间范围，请使用“最近三个月”“近 90 天”或具体起止日期。");
  }
  const months = [...question.matchAll(/(?:(\d{4})年)?(\d{1,2})月/g)];
  if (months.length > 1) return clarify("请明确本次要查询的一个月份或起止日期。");
  if (months.length === 1) {
    const year = months[0][1] ?? String(impliedYear);
    const first = `${year}-${months[0][2].padStart(2, "0")}-01`;
    if (!isCalendarDate(first) || first > today) return clarify("请指定不晚于当前月份的有效月份。");
    return make(parseISO(first), new Date(Math.min(endOfMonth(parseISO(first)).getTime(), date.getTime())), `${year}年${months[0][2]}月`);
  }
  if (/上个?月/.test(question)) {
    const previous = subMonths(date, 1);
    return make(startOfMonth(previous), endOfMonth(previous), "上个自然月");
  }
  if (/(本月|这个月|这月)/.test(question)) return make(startOfMonth(date), date, "本月至今");
  if (/去年/.test(question)) return make(startOfYear(subYears(date, 1)), endOfYear(subYears(date, 1)), "去年");
  if (/今年/.test(question)) return make(startOfYear(date), date, "今年至今");
  if (/上周/.test(question)) {
    const previous = subDays(date, 7);
    return make(startOfWeek(previous, { weekStartsOn: 1 }), endOfWeek(previous, { weekStartsOn: 1 }), "上个自然周");
  }
  if (/(本周|这周)/.test(question)) return make(startOfWeek(date, { weekStartsOn: 1 }), date, "本周至今");
  if (/昨天/.test(question)) return make(subDays(date, 1), subDays(date, 1), "昨天");
  if (/今天|今日/.test(question)) return make(date, date, "今日");
  if (/一个月|一月|上.*年|前年|\d{4}年/.test(question)) return clarify("请明确起止日期，或使用“上个月”“近 30 天”等时间范围。");
  return fallback();
}

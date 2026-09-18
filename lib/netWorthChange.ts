import type { AssetValuationDaily, PortfolioSnapshot } from "./db";
import type { PortfolioEvent } from "./portfolioEvents";

export const CHANGE_LABELS = {
  deposit: "入金", expense: "消费", dividend: "分红到账", fx: "汇率变化",
  securities: "证券价格变动", other: "其他资产估值变化", liability: "负债变化",
  created: "新增资产", deleted: "删除资产", adjustment: "手动校准",
  unlinked_trade: "未关联现金的交易", unclassified: "未归因"
} as const;
export type ChangeKind = keyof typeof CHANGE_LABELS;
export interface ChangeItem { kind: ChangeKind; label: string; amount: number }
export interface NetWorthChange {
  from: string | null;
  to: string;
  comparison: string;
  total: number | null;
  percent: number | null;
  items: ChangeItem[];
  partial: boolean;
  notes: string[];
}

const sign = (category: string) => category === "liability" ? -1 : 1;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const cents = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100);

function previousDay(date: string) {
  const d = new Date(`${date}T12:00:00+08:00`);
  d.setTime(d.getTime() - 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** 只使用两端固化估值与区间事件；不读取当前价格，不把余额差额猜成收入。 */
export function calculateNetWorthChange(input: {
  previous?: PortfolioSnapshot;
  current: PortfolioSnapshot;
  previousAssets: AssetValuationDaily[];
  currentAssets: AssetValuationDaily[];
  events: PortfolioEvent[];
  reliableFrom: string | null;
}): NetWorthChange {
  const { previous, current, previousAssets, currentAssets, reliableFrom } = input;
  const result: NetWorthChange = {
    from: previous?.date ?? null, to: current.date,
    comparison: previous ? previous.date === previousDay(current.date) ? "较昨日" : `较上次快照（${previous.date}）` : "暂无对比快照",
    total: previous ? (cents(current.total_value) - cents(previous.total_value)) / 100 : null,
    percent: previous && previous.total_value !== 0 ? (current.total_value - previous.total_value) / Math.abs(previous.total_value) : null,
    items: [], partial: false, notes: []
  };
  if (!previous) return result;
  const totals = new Map<ChangeKind, number>();
  const add = (kind: ChangeKind, amount: number) => totals.set(kind, (totals.get(kind) ?? 0) + amount);
  const notes = new Set<string>();
  const incomplete = (note: string) => { result.partial = true; notes.add(note); };
  const reliable = reliableFrom != null && reliableFrom <= previous.created_at;
  if (!reliable) incomplete("此区间早于可靠事件记录起点，无法确认的变化保留为未归因。");
  const validEndpoint = (rows: AssetValuationDaily[], snapshot: PortfolioSnapshot) =>
    rows.length > 0 && Math.abs(rows.reduce((sum, row) => sum + sign(row.category_code) * row.base_value, 0) - snapshot.total_value) < 0.01;
  // 空明细无法区分“空仓”与旧版快照缺数据，保守保留缺口。
  const detailed = validEndpoint(previousAssets, previous) && validEndpoint(currentAssets, current);
  if (!detailed) incomplete("快照缺少完整的逐资产估值，无法拆分的差额保留为未归因。");

  const before = new Map(previousAssets.map(row => [row.asset_id, row]));
  const after = new Map(currentAssets.map(row => [row.asset_id, row]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const nativeEffects = new Map<number, number>();
  const quantityEffects = new Map<number, number>();
  const blocked = new Set<number>();
  const created = new Set<number>();
  const deleted = new Set<number>();
  const rates = new Map<string, number>();
  const hints = new Map<number, { currency: string; category: string }>();

  for (const currency of new Set([...previousAssets, ...currentAssets].map(row => row.currency))) {
    const left = previousAssets.filter(row => row.currency === currency);
    const right = currentAssets.filter(row => row.currency === currency);
    const lRate = left[0]?.fx_rate, rRate = right[0]?.fx_rate;
    const valid = (rows: AssetValuationDaily[], rate: number | null | undefined) =>
      finite(rate) && rate > 0 && rows.every(row => row.fx_rate === rate && near(row.native_value * rate, row.base_value));
    if (!detailed || !left.length || !right.length || !valid(left, lRate) || !valid(right, rRate)) {
      incomplete("新增或消失的币种、缺失的历史汇率不做推算。");
      continue;
    }
    const native = (rows: AssetValuationDaily[]) => rows.reduce((sum, row) => sum + sign(row.category_code) * row.native_value, 0);
    add("fx", (native(left) + native(right)) / 2 * (rRate! - lRate!));
    rates.set(currency, (lRate! + rRate!) / 2);
  }

  const events = input.events.filter(event => event.occurredAt.slice(0, 10) > previous.date &&
    event.occurredAt.slice(0, 10) <= current.date && event.occurredAt <= current.created_at)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id);
  const affect = (id: number, amount: number, quantity = 0) => {
    nativeEffects.set(id, (nativeEffects.get(id) ?? 0) + amount);
    quantityEffects.set(id, (quantityEffects.get(id) ?? 0) + quantity);
  };
  for (const event of events) {
    for (const leg of event.legs) if (leg.assetId != null) {
      ids.add(leg.assetId);
      const category = event.metadata?.category_code;
      hints.set(leg.assetId, { currency: event.currency,
        category: typeof category === "string" ? category : leg.role === "security" ? "securities" : leg.role === "cash" ? "cash" : "other" });
    }
    const rate = rates.get(event.currency);
    const fail = () => {
      event.legs.forEach(leg => { if (leg.assetId != null) blocked.add(leg.assetId); });
      incomplete("部分操作缺少估值或关联信息，相关差额保留为未归因。");
    };
    if (rate == null) { fail(); continue; }
    if (event.legs.some(leg => leg.assetId == null ||
      [before.get(leg.assetId), after.get(leg.assetId)].some(row => row && row.currency !== event.currency))) { fail(); continue; }

    if (["cash_deposit", "cash_expense", "security_dividend"].includes(event.type)) {
      const cash = event.legs.filter(leg => leg.role === "cash");
      if (!cash.length || cash.some(leg => !finite(leg.amountDelta))) { fail(); continue; }
      const kind = event.type === "cash_deposit" ? "deposit" : event.type === "cash_expense" ? "expense" : "dividend";
      for (const leg of cash) {
        add(kind, leg.amountDelta! * rate);
        affect(leg.assetId!, leg.amountDelta!);
      }
      // 分红可能同步调整券商成本；缺少当时市价时不能把成本变化当行情盈亏。
      if (event.type === "security_dividend") for (const leg of event.legs.filter(leg => leg.role === "security")) {
        const row = before.get(leg.assetId!) ?? after.get(leg.assetId!);
        if (!row || row.unit_price === row.unit_cost) blocked.add(leg.assetId!);
      }
    } else if (["security_buy", "security_sell", "security_liquidation"].includes(event.type)) {
      const security = event.legs.filter(leg => leg.role === "security");
      const cash = event.legs.filter(leg => leg.role === "cash");
      if (!security.length || security.some(leg => !finite(leg.quantityDelta) || !finite(leg.unitPrice)) ||
        cash.some(leg => !finite(leg.amountDelta))) { fail(); continue; }
      let net = 0;
      for (const leg of security) {
        const amount = leg.quantityDelta! * leg.unitPrice!;
        affect(leg.assetId!, amount, leg.quantityDelta!);
        net += amount;
        const oldRow = before.get(leg.assetId!);
        if (oldRow && oldRow.unit_price === oldRow.unit_cost && finite(leg.unitCostAfter) && leg.unitCostAfter !== oldRow.unit_cost) {
          // 日估值兼容用成本代替缺失市价；此时成本校准不能被认作行情收益。
          blocked.add(leg.assetId!);
        }
        if (!before.has(leg.assetId!) && event.type === "security_buy") created.add(leg.assetId!);
        if (event.type === "security_liquidation") deleted.add(leg.assetId!);
      }
      for (const leg of cash) { affect(leg.assetId!, leg.amountDelta!); net += leg.amountDelta!; }
      if (!cash.length) {
        add("unlinked_trade", net * rate);
        notes.add("未关联现金的交易单列持仓增减金额，不视为投资盈亏；未记录的费用与税费无法单独统计。");
      } else if (!near(net, 0)) {
        // 当前交易 API 不记录费用；无法解释的现金/成交差额不猜成手续费。
        add("unclassified", net * rate);
        incomplete("交易现金与成交金额存在差额，未归因部分可能需要补充记录。");
      }
    } else if (event.type === "asset_created" || event.type === "asset_deleted") {
      const leg = event.legs[0];
      const category = event.metadata?.category_code;
      if (event.legs.length !== 1 || !finite(event.grossAmount) || typeof category !== "string") { fail(); continue; }
      if (event.grossAmount === 0 && (leg.quantityDelta ?? 0) !== 0 && (leg.unitPrice ?? 0) > 0) { fail(); continue; }
      const direction = event.type === "asset_created" ? 1 : -1;
      const amount = direction * event.grossAmount;
      add(category === "liability" ? "liability" : direction === 1 ? "created" : "deleted", sign(category) * amount * rate);
      affect(leg.assetId!, amount, leg.quantityDelta ?? 0);
      (direction === 1 ? created : deleted).add(leg.assetId!);
    } else if (event.type === "manual_adjustment") {
      const leg = event.legs[0];
      const meta = event.metadata;
      if (event.legs.length !== 1 || !leg) { fail(); continue; }
      const oldRow = before.get(leg.assetId!), newRow = after.get(leg.assetId!);
      const category = newRow?.category_code ?? oldRow?.category_code;
      const changes = meta?.changes as Record<string, { from: unknown; to: unknown }> | undefined;
      const oldValue = meta?.native_value_before, newValue = meta?.native_value_after;
      if (finite(oldValue) && finite(newValue) && meta?.currency_before === event.currency && meta?.currency_after === event.currency &&
        typeof meta?.category_before === "string" && typeof meta?.category_after === "string") {
        add(meta.category_before === "liability" && meta.category_after === "liability" ? "liability" : "adjustment",
          (sign(meta.category_after) * newValue - sign(meta.category_before) * oldValue) * rate);
        affect(leg.assetId!, newValue - oldValue, leg.quantityDelta ?? 0);
        if (meta.category_before !== meta.category_after || changes?.symbol) blocked.add(leg.assetId!);
      } else if (category && oldRow && newRow && oldRow.category_code === newRow.category_code &&
        !oldRow.quantity && !newRow.quantity && changes?.amount &&
        finite(changes.amount.from) && finite(changes.amount.to) &&
        Object.keys(changes).every(key => ["amount", "unit_cost", "current_price"].includes(key))) {
        const amount = changes.amount.to - changes.amount.from;
        add(category === "liability" ? "liability" : "adjustment", sign(category) * amount * rate);
        affect(leg.assetId!, amount);
      } else if (changes && Object.keys(changes).every(key => key === "account_name")) {
        // 改账户名称不影响估值。
      } else { fail(); }
    } else { fail(); }
  }

  for (const id of ids) {
    const left = before.get(id), right = after.get(id), row = right ?? left;
    const hint = hints.get(id);
    const category = row?.category_code ?? hint?.category;
    const rate = rates.get(row?.currency ?? hint?.currency ?? "");
    if (rate == null || blocked.has(id) || !reliable || !detailed) continue;
    if ((left && right && (left.currency !== right.currency || left.category_code !== right.category_code)) ||
      (!left && !created.has(id)) || (!right && !deleted.has(id))) {
      incomplete("资产身份、分类或增删记录不完整，相关变化保留为未归因。");
      continue;
    }
    const residual = (right?.native_value ?? 0) - (left?.native_value ?? 0) - (nativeEffects.get(id) ?? 0);
    if (category === "securities") {
      const qtyMatches = near((left?.quantity ?? 0) + (quantityEffects.get(id) ?? 0), right?.quantity ?? 0);
      const priced = [left, right].every(side => !side || (!(side.amount != null && side.amount > 0) && side.unit_price != null));
      if (qtyMatches && priced) add("securities", residual * rate);
      else incomplete("部分证券持仓变化缺少成交或价格记录，无法确认为证券盈亏。");
    } else if (category === "liability") {
      add("liability", -residual * rate);
    } else if (category !== "cash") {
      add("other", residual * rate);
    } else if (!near(residual, 0)) incomplete("现金余额存在无法对应业务记录的变化，未将其推断为利息或入金。");
  }

  // 按显示精度对账：各行分值之和严格等于两端净值的显示差额。
  let classifiedCents = 0;
  for (const [kind, label] of Object.entries(CHANGE_LABELS)) {
    if (kind === "unclassified") continue;
    const amount = cents(totals.get(kind as ChangeKind) ?? 0);
    if (amount !== 0) { result.items.push({ kind: kind as ChangeKind, label, amount: amount / 100 }); classifiedCents += amount; }
  }
  const remainder = cents(result.total!) - classifiedCents;
  if (remainder !== 0 || result.partial) {
    result.items.push({ kind: "unclassified", label: CHANGE_LABELS.unclassified, amount: remainder / 100 });
    if (remainder !== 0) result.partial = true;
  }
  result.notes = [...notes];
  return result;
}

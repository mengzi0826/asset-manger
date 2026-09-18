import { NextResponse } from "next/server";
import { listChanges, listSnapshots, recordSnapshot } from "@/lib/history";
import { getSetting } from "@/lib/db";
import { z } from "zod";
import { isCalendarDate } from "@/lib/analysisPeriod";
import { summarizePortfolioPeriod } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const baseCurrency = (url.searchParams.get("base") ?? getSetting("base_currency") ?? "CNY").toUpperCase();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 1000);
    const days = Math.min(Number(url.searchParams.get("days") ?? 365), 3650);
    z.enum(["CNY", "USD"]).parse(baseCurrency);
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(days) || days < 1) throw new Error("limit 和 days 必须为正整数");
    const from = url.searchParams.get("from") || undefined;
    const to = url.searchParams.get("to") || undefined;
    if ((from == null) !== (to == null) || (from && (!isCalendarDate(from) || !isCalendarDate(to!) || from > to!))) {
      throw new Error("请同时提供有效的 from / to 起止日期");
    }
    if (from && (Date.parse(to!) - Date.parse(from)) / 86400000 > 3650) throw new Error("单次区间最多 3650 天");
    const snapshots = listSnapshots(baseCurrency, days, { from, to });
    const changes = listChanges(limit).map((c) => ({
      ...c,
      field_changes: c.field_changes ? JSON.parse(c.field_changes) : null,
      snapshot: c.snapshot ? JSON.parse(c.snapshot) : null
    }));
    const period = from && to ? summarizePortfolioPeriod(baseCurrency, from, to) : null;
    return NextResponse.json({ baseCurrency, snapshots, changes, period });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? "Invalid" }, { status: 400 });
  }
}

export async function POST() {
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const snap = recordSnapshot(baseCurrency);
  return NextResponse.json({ snapshot: snap });
}

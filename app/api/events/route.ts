import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getPortfolioEventCoverage,
  listPortfolioEvents,
  summarizePortfolioEvents,
  type PortfolioEventType
} from "@/lib/portfolioEvents";
import { isCalendarDate } from "@/lib/analysisPeriod";

export const dynamic = "force-dynamic";

const dateSchema = z.string().refine(isCalendarDate, "日期无效");
const allowedTypes: PortfolioEventType[] = [
  "asset_created",
  "asset_deleted",
  "manual_adjustment",
  "cash_deposit",
  "cash_expense",
  "security_buy",
  "security_sell",
  "security_dividend",
  "security_liquidation"
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const fromDate = url.searchParams.get("from") || undefined;
    const toDate = url.searchParams.get("to") || undefined;
    if (fromDate) dateSchema.parse(fromDate);
    if (toDate) dateSchema.parse(toDate);
    if (fromDate && toDate && fromDate > toDate) throw new Error("from 不得晚于 to");
    const rawTypes = url.searchParams.getAll("type");
    const types = rawTypes.length
      ? rawTypes.map((type) => {
          if (!allowedTypes.includes(type as PortfolioEventType)) throw new Error(`不支持的事件类型：${type}`);
          return type as PortfolioEventType;
        })
      : undefined;
    const limit = Number(url.searchParams.get("limit") ?? 500);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit 必须是正整数");

    const summary = summarizePortfolioEvents(fromDate ?? "0001-01-01", toDate ?? "9999-12-31")
      .filter(row => !types || types.includes(row.type));
    const events = listPortfolioEvents({ fromDate, toDate, types, limit });
    return NextResponse.json({
      coverage: getPortfolioEventCoverage(),
      summary,
      totalCount: summary.reduce((sum, row) => sum + row.count, 0),
      returnedCount: events.length,
      events
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

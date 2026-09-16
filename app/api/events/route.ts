import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getPortfolioEventCoverage,
  listPortfolioEvents,
  type PortfolioEventType
} from "@/lib/portfolioEvents";

export const dynamic = "force-dynamic";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
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
    const rawTypes = url.searchParams.getAll("type");
    const types = rawTypes.length
      ? rawTypes.map((type) => {
          if (!allowedTypes.includes(type as PortfolioEventType)) throw new Error(`不支持的事件类型：${type}`);
          return type as PortfolioEventType;
        })
      : undefined;
    const limit = Number(url.searchParams.get("limit") ?? 500);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit 必须是正整数");

    return NextResponse.json({
      coverage: getPortfolioEventCoverage(),
      events: listPortfolioEvents({ fromDate, toDate, types, limit })
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

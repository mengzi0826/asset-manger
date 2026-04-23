import { NextResponse } from "next/server";
import { z } from "zod";
import { getSetting, setSetting, removeSetting } from "@/lib/db";
import {
  SETTING_JUHE_FX_APPKEY,
  SETTING_JUHE_STOCK_APPKEY,
  getFxKeyFieldState,
  getStockKeyFieldState
} from "@/lib/juheKeys";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  base_currency: z.string().trim().length(3).optional(),
  juhe_fx_appkey: z.union([z.string().trim().min(1), z.null()]).optional(),
  juhe_stock_appkey: z.union([z.string().trim().min(1), z.null()]).optional()
});

export async function GET() {
  return NextResponse.json({
    base_currency: (getSetting("base_currency") ?? "CNY").toUpperCase(),
    juhe_fx: getFxKeyFieldState(),
    juhe_stock: getStockKeyFieldState()
  });
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    if (parsed.base_currency) {
      setSetting("base_currency", parsed.base_currency.toUpperCase());
    }
    if (parsed.juhe_fx_appkey !== undefined) {
      if (parsed.juhe_fx_appkey === null) {
        removeSetting(SETTING_JUHE_FX_APPKEY);
      } else {
        setSetting(SETTING_JUHE_FX_APPKEY, parsed.juhe_fx_appkey);
      }
    }
    if (parsed.juhe_stock_appkey !== undefined) {
      if (parsed.juhe_stock_appkey === null) {
        removeSetting(SETTING_JUHE_STOCK_APPKEY);
      } else {
        setSetting(SETTING_JUHE_STOCK_APPKEY, parsed.juhe_stock_appkey);
      }
    }
    return NextResponse.json({
      base_currency: (getSetting("base_currency") ?? "CNY").toUpperCase(),
      juhe_fx: getFxKeyFieldState(),
      juhe_stock: getStockKeyFieldState()
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSetting } from "@/lib/db";
import { listAssetValuations, summarizeFxImpact } from "@/lib/history";

export const dynamic = "force-dynamic";

const querySchema = z
  .object({
    base: z.enum(["CNY", "USD"]).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    asset_id: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(20000).default(5000)
  })
  .refine((v) => (v.from == null) === (v.to == null), {
    message: "from 和 to 必须同时提供"
  })
  .refine((v) => !v.from || !v.to || v.from < v.to, {
    message: "from 必须早于 to"
  });

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams);
    if (typeof raw.base === "string") raw.base = raw.base.toUpperCase();
    const query = querySchema.parse(raw);
    const baseCurrency = query.base ?? (getSetting("base_currency") ?? "CNY").toUpperCase();
    const valuations = listAssetValuations({
      baseCurrency,
      from: query.from,
      to: query.to,
      assetId: query.asset_id,
      limit: query.limit
    });
    const fxImpact =
      query.from && query.to ? summarizeFxImpact(baseCurrency, query.from, query.to) : null;
    return NextResponse.json({ baseCurrency, valuations, fxImpact });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

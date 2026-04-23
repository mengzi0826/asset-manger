import { NextResponse } from "next/server";
import { z } from "zod";
import { listRates, refreshRates, setManualRate, SUPPORTED_CURRENCIES } from "@/lib/fx";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const result = await refreshRates(force);
  return NextResponse.json({
    rates: listRates(),
    supported: SUPPORTED_CURRENCIES,
    refresh: result
  });
}

const manualSchema = z.object({
  base: z.string().trim().length(3),
  quote: z.string().trim().length(3),
  rate: z.number().positive()
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = manualSchema.parse(body);
    setManualRate(parsed.base.toUpperCase(), parsed.quote.toUpperCase(), parsed.rate);
    return NextResponse.json({ ok: true, rates: listRates() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

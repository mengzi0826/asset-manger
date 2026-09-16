import { NextResponse } from "next/server";
import { z } from "zod";
import { listRateHistory } from "@/lib/fx";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  base: z.string().trim().length(3).optional(),
  quote: z.string().trim().length(3).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(10000).default(1000)
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const rates = listRateHistory({
      base: query.base,
      quote: query.quote,
      from: query.from ? `${query.from}T00:00:00+08:00` : undefined,
      to: query.to ? `${query.to}T23:59:59+08:00` : undefined,
      limit: query.limit
    });
    return NextResponse.json({ rates });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { getMarketFreshness } from "@/lib/marketFreshness";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getMarketFreshness());
}

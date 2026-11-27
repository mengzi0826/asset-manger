import { NextResponse } from "next/server";
import { undoSecurityTrade } from "@/lib/securityTradeUndo";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const assetId = Number(params.id);
  const body = await req.json().catch(() => null);
  if (!Number.isSafeInteger(assetId) || assetId <= 0 || !Number.isSafeInteger(body?.eventId) || body.eventId <= 0) {
    return NextResponse.json({ error: "无效的交易记录" }, { status: 400 });
  }
  try {
    return NextResponse.json(undoSecurityTrade(assetId, body.eventId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "撤回失败" }, { status: 409 });
  }
}

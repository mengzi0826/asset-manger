import { NextResponse } from "next/server";
import { listChanges, listSnapshots, recordSnapshot } from "@/lib/history";
import { getSetting } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseCurrency = (url.searchParams.get("base") ?? getSetting("base_currency") ?? "CNY").toUpperCase();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 1000);
  const days = Math.min(Number(url.searchParams.get("days") ?? 365), 3650);
  const snapshots = listSnapshots(baseCurrency, days);
  const changes = listChanges(limit).map((c) => ({
    ...c,
    field_changes: c.field_changes ? JSON.parse(c.field_changes) : null,
    snapshot: c.snapshot ? JSON.parse(c.snapshot) : null
  }));
  return NextResponse.json({ baseCurrency, snapshots, changes });
}

export async function POST() {
  const baseCurrency = (getSetting("base_currency") ?? "CNY").toUpperCase();
  const snap = recordSnapshot(baseCurrency);
  return NextResponse.json({ snapshot: snap });
}

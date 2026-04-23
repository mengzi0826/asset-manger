import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";

export const dynamic = "force-dynamic";

const accountSchema = z.object({
  category_id: z.number().int().positive(),
  name: z.string().trim().min(1, "名称不能为空"),
  institution: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable()
});

export async function GET() {
  const db = getDB();
  const rows = db.prepare("SELECT * FROM account ORDER BY category_id, name").all();
  return NextResponse.json({ accounts: rows });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = accountSchema.parse(body);
    const db = getDB();
    const res = db
      .prepare(
        "INSERT INTO account (category_id, name, institution, notes) VALUES (?, ?, ?, ?)"
      )
      .run(parsed.category_id, parsed.name, parsed.institution ?? null, parsed.notes ?? null);
    const account = db.prepare("SELECT * FROM account WHERE id = ?").get(res.lastInsertRowid);
    return NextResponse.json({ account }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

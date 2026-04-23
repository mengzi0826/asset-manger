import { NextResponse } from "next/server";
import { z } from "zod";
import { getDB } from "@/lib/db";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  institution: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  category_id: z.number().int().positive().optional()
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    const db = getDB();
    const exists = db.prepare("SELECT id FROM account WHERE id = ?").get(id);
    if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
    const keys = Object.keys(parsed) as (keyof typeof parsed)[];
    if (keys.length === 0) return NextResponse.json({ ok: true });
    const sets = keys.map((k) => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE account SET ${sets} WHERE id = @id`).run({ ...parsed, id });
    const account = db.prepare("SELECT * FROM account WHERE id = ?").get(id);
    return NextResponse.json({ account });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Invalid" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const db = getDB();
  db.prepare("DELETE FROM account WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}

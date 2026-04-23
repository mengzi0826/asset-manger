import { NextResponse } from "next/server";
import { getDB, type Category } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDB();
  const categories = db
    .prepare("SELECT * FROM category ORDER BY sort_order, id")
    .all() as Category[];
  const accounts = db
    .prepare("SELECT * FROM account ORDER BY category_id, name")
    .all();
  return NextResponse.json({ categories, accounts });
}

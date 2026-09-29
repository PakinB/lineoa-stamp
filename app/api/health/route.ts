import { sql } from "@/lib/db";
import { json, handler } from "@/lib/http";

/**
 * เส้นตรวจสุขภาพระบบ
 *
 * มีไว้สองอย่าง:
 *   1. ให้ cron แตะฐานข้อมูลวันละครั้ง กัน Supabase ชั้นฟรีหยุดเองเมื่อไม่มีการใช้งาน
 *   2. ใช้เช็คเร็ว ๆ ว่าเว็บกับฐานข้อมูลยังคุยกันได้ไหม
 *
 * ไม่คืนข้อมูลอะไรที่เป็นความลับ และยิง SQL คำสั่งเดียวตามกฎใน lib/db.ts
 */
export async function GET() {
  return handler(async () => {
    const t0 = Date.now();
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM branches`;
    return json({ ok: true, branches: row.n, db_ms: Date.now() - t0 });
  });
}

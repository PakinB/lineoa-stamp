import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/** ทุกอย่างที่หน้าจัดการเดลิเวอรี่ต้องใช้ ในคำขอเดียว */
export async function GET() {
  return handler(async () => {
    await requireStaff("owner");
    const [row] = await sql<{ result: unknown }[]>`SELECT api_admin_delivery() AS result`;
    return json(row.result);
  });
}

/**
 * บันทึกโซน · เมนู · ส่วนลด · เซ็ตน้ำหนัก · ค่าตั้งค่า
 *
 * ใช้เส้นเดียวแยกด้วย kind เพราะหนึ่งคำขอยิง SQL ได้คำสั่งเดียว
 * รายการ key ที่แก้ได้ถูกล็อกไว้ในฟังก์ชัน ไม่ใช่ที่นี่
 */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff("owner");
    const body = (await req.json()) as { kind?: string; data?: unknown };
    if (!body.kind) return fail("kind_required", 400);

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_admin_delivery_save(${body.kind},
                                     ${JSON.stringify(body.data ?? {})},
                                     ${sess.sid}) AS result`;
    return json(row.result, row.result.ok ? 200 : 400);
  });
}

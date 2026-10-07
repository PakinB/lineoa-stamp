import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/**
 * แก้ไขโปรโมชั่น — ชื่อ จำนวนดวง กติกา และเปิด/ปิด
 *
 * **ไม่มีปุ่มลบโดยตั้งใจ** โปรโมชั่นที่เคยออก QR ไปแล้วมีประวัติผูกอยู่
 * ลบทิ้งแล้วรายงานย้อนหลังจะอ่านไม่ออกว่าดวงพวกนั้นมาจากไหน — ใช้ "ปิด" แทน
 *
 * จำนวนดวงที่แก้มีผลกับ QR ใบใหม่เท่านั้น ใบที่ออกไปแล้วติดเลขดวงไว้ในตัวมัน
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const sess = await requireStaff("owner");
    const { id } = await ctx.params;

    const body = (await req.json()) as {
      name?: string;
      points?: number;
      once_per_customer?: boolean;
      is_active?: boolean;
    };

    const [row] = await sql<{ result: { ok: boolean; reason?: string } }[]>`
      SELECT api_admin_save_promo_campaign(
        ${id}, ${body.name ?? null}, ${body.points ?? null},
        ${body.once_per_customer ?? null}, ${body.is_active ?? null}, ${sess.sid}
      ) AS result`;

    return json(row.result, row.result.ok ? 200 : 400);
  });
}

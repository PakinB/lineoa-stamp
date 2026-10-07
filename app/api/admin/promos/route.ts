import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/** รายการโปรโมชั่นทั้งหมดพร้อมสถิติการใช้งาน */
export async function GET() {
  return handler(async () => {
    await requireStaff("owner");

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_admin_promo_campaigns() AS result`;

    return json(row.result);
  });
}

/**
 * สร้างโปรโมชั่นใหม่
 *
 * จำนวนดวงถูกบีบให้อยู่ใน 1–10 ที่ฝั่งฐานข้อมูล ไม่เชื่อเลขจากเบราว์เซอร์
 */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff("owner");

    const body = (await req.json()) as {
      name?: string;
      points?: number;
      once_per_customer?: boolean;
    };

    if (!body.name || !body.name.trim()) return fail("name_required", 400);

    const [row] = await sql<{ result: { ok: boolean; reason?: string } }[]>`
      SELECT api_admin_save_promo_campaign(
        ${null}, ${body.name.trim()}, ${body.points ?? 3},
        ${body.once_per_customer ?? true}, ${true}, ${sess.sid}
      ) AS result`;

    return json(row.result, row.result.ok ? 200 : 400);
  });
}

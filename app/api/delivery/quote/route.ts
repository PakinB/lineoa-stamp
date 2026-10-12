import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, fail, handler } from "@/lib/http";

/**
 * ดูราคาก่อนกดสั่ง
 *
 * ใช้ตัวคิดเงินตัวเดียวกับตอนสั่งจริง ราคาที่ลูกค้าเห็นกับที่เก็บเงินจึงตรงกันเสมอ
 * **ไม่รับราคาจากเบราว์เซอร์** ส่งมาแค่ว่าเลือกอะไรกี่กรัม
 */
export async function POST(req: Request) {
  return handler(async () => {
    await requireIdentity(req);
    const body = (await req.json()) as { zone_id?: string; items?: unknown[] };
    if (!body.zone_id) return fail("zone_required", 400);

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_delivery_quote(${body.zone_id},
                                ${JSON.stringify(body.items ?? [])}) AS result`;
    return json(row.result, row.result.ok ? 200 : 400);
  });
}

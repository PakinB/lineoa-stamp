import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, handler } from "@/lib/http";

/**
 * ลูกค้ากดสั่ง
 *
 * ยอดเงินทั้งหมดคิดใหม่ฝั่งฐานข้อมูล ไม่สนใจตัวเลขที่ส่งมา
 * ที่อยู่กับเบอร์โทรเก็บได้ต่อเมื่อลูกค้ายินยอม PDPA แล้วเท่านั้น (ตรวจใน SQL)
 */
export async function POST(req: Request) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const body = await req.json();

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_delivery_create(${me.userId}, ${me.displayName}, ${me.pictureUrl},
                                 ${JSON.stringify(body)}) AS result`;
    return json(row.result, row.result.ok ? 200 : 400);
  });
}

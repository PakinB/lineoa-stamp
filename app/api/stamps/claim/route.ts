import { sql } from "@/lib/db";
import { requireCustomer } from "@/lib/auth/line";
import { assertCanEarn } from "@/lib/limits";
import { json, fail, handler } from "@/lib/http";

/**
 * ลูกค้าสแกน QR สะสมแต้ม
 *
 * ตรรกะทั้งหมดอยู่ใน claim_earn_token() ฝั่งฐานข้อมูล เพื่อให้ atomic จริง
 * เส้นนี้มีหน้าที่แค่ยืนยันตัวตน เช็คเพดาน แล้วส่งต่อ
 */
export async function POST(req: Request) {
  return handler(async () => {
    const me = await requireCustomer(req);
    const { code } = (await req.json()) as { code?: string };
    if (!code) return fail("invalid_or_used");

    const [{ branch_id }] = await sql<{ branch_id: string | null }[]>`
      SELECT branch_id FROM earn_tokens WHERE code = ${code}
      UNION ALL SELECT NULL LIMIT 1`;
    await assertCanEarn(me.id, branch_id);

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT claim_earn_token(${me.id}, ${code}) AS result`;
    return json(row.result, row.result.ok ? 200 : 409);
  });
}

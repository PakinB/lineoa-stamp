import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, fail, handler } from "@/lib/http";

/**
 * ลูกค้าสแกน QR สะสมแต้ม
 *
 * ทุกอย่างอยู่ในคำสั่งเดียว: อัปเสิร์ตลูกค้า เช็คเพดาน แล้วเคลมรหัส
 * ตรรกะการเคลมยังคงเป็นการล็อกแถวใน claim_earn_token เหมือนเดิม (§5)
 */
export async function POST(req: Request) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const { code } = (await req.json()) as { code?: string };
    if (!code) return fail("invalid_or_used");

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_claim_token(${me.userId}, ${me.displayName}, ${me.pictureUrl}, ${code}) AS result`;
    return json(row.result, row.result.ok ? 200 : 409);
  });
}

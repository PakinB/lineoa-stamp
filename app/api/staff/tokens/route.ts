import { sql } from "@/lib/db";
import { requireStaff, branchOf } from "@/lib/auth/staff";
import { newCode, liffUrl } from "@/lib/codes";
import { getSetting } from "@/lib/settings";
import { json, handler } from "@/lib/http";

/**
 * พนักงานกด "ออก QR" ตอนเก็บเงิน
 *
 * เลขบิล (order_ref) ไม่บังคับ — สาขาที่ไม่มี POS ส่วนใหญ่ไม่มีเลขบิลจะให้ใส่
 * คืน url สำหรับให้หน้าเว็บวาด QR เองฝั่งเบราว์เซอร์
 * (ไม่วาดฝั่งเซิร์ฟเวอร์ เพราะไลบรารี QR ส่วนใหญ่พึ่ง Node API ที่ edge runtime ไม่มี)
 */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff();
    const body = (await req.json().catch(() => ({}))) as {
      order_ref?: string; branch_id?: string;
    };
    const branchId = await branchOf(sess, body.branch_id);
    const ttl = await getSetting<number>("token_ttl_minutes", 10);
    const code = newCode();

    const [row] = await sql<{ expires_at: Date }[]>`
      INSERT INTO earn_tokens (code, branch_id, order_ref, issued_by, expires_at)
      VALUES (${code}, ${branchId}, ${body.order_ref ?? null}, ${sess.sid},
              now() + make_interval(mins => ${ttl}))
      RETURNING expires_at`;

    return json({ ok: true, code, url: liffUrl({ t: code }), expires_at: row.expires_at });
  });
}

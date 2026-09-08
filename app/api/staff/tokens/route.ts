import { sql } from "@/lib/db";
import { requireStaff, branchOf } from "@/lib/auth/staff";
import { newCode, liffUrl } from "@/lib/codes";
import { json, handler } from "@/lib/http";

/**
 * พนักงานกด "ออก QR" ตอนเก็บเงิน
 *
 * เลขบิลไม่บังคับ — สาขาที่ไม่มี POS ส่วนใหญ่ไม่มีเลขบิลจะให้ใส่
 * อ่านอายุ QR จากค่าตั้งค่าและบันทึกในคำสั่งเดียว (ดู 0003_api.sql)
 */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff();
    const body = (await req.json().catch(() => ({}))) as {
      order_ref?: string; branch_id?: string;
    };
    const branchId = await branchOf(sess, body.branch_id);
    const code = newCode();

    const [row] = await sql<{ result: { expires_at: string } }[]>`
      SELECT api_issue_token(${branchId}, ${sess.sid}, ${code}, ${body.order_ref ?? null})
             AS result`;

    return json({ ok: true, code, url: liffUrl({ t: code }), expires_at: row.result.expires_at });
  });
}

import { sql } from "@/lib/db";
import { requireStaff, branchOf } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/**
 * สรุปกะ
 *
 * §4: ตัวเลข "ออกแล้วไม่มีคนสแกน" คือสัญญาณที่มีค่าที่สุด
 * ถ้าสูงผิดปกติแปลว่าพนักงานกดออก QR แล้วไม่ได้ยื่นให้ลูกค้าจริง
 */
export async function GET(req: Request) {
  return handler(async () => {
    const sess = await requireStaff();
    const url = new URL(req.url);
    const branchId = await branchOf(sess, url.searchParams.get("branch_id"));

    const [t] = await sql<{ issued: number; claimed: number }[]>`
      SELECT count(*)::int AS issued,
             count(*) FILTER (WHERE status = 'consumed')::int AS claimed
        FROM earn_tokens
       WHERE branch_id = ${branchId}
         AND issued_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                          AT TIME ZONE 'Asia/Bangkok'`;

    const rewards = await sql<{ name: string; n: number }[]>`
      SELECT o.name, count(*)::int AS n
        FROM entitlements e
        JOIN reward_options o ON o.id = e.chosen_option_id
       WHERE e.status = 'used' AND e.used_branch_id = ${branchId}
         AND e.used_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                          AT TIME ZONE 'Asia/Bangkok'
       GROUP BY o.name ORDER BY n DESC`;

    return json({
      ok: true,
      qr_issued: t.issued,
      qr_claimed: t.claimed,
      qr_unclaimed: t.issued - t.claimed,
      rewards_given: rewards,
    });
  });
}

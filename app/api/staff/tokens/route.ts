import { sql } from "@/lib/db";
import { requireStaff, branchOf } from "@/lib/auth/staff";
import { newCode, liffUrl } from "@/lib/codes";
import { getSetting } from "@/lib/settings";
import { json, handler } from "@/lib/http";

/**
 * พนักงานกด "ออก QR"
 *
 * ส่ง promo:true มาเมื่อเป็น QR โปรโมชั่น — **จำนวนดวงอ่านจาก app_settings
 * ฝั่งเซิร์ฟเวอร์ ไม่รับตัวเลขจากฝั่งเบราว์เซอร์** ไม่งั้นใครแก้คำขอก็ขอกี่ดวงก็ได้
 *
 * เลขบิลไม่บังคับ — สาขาที่ไม่มี POS ส่วนใหญ่ไม่มีเลขบิลจะให้ใส่
 */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff();
    const body = (await req.json().catch(() => ({}))) as {
      order_ref?: string;
      branch_id?: string;
      promo?: boolean;
    };
    const branchId = await branchOf(sess, body.branch_id);
    const code = newCode();

    const points = body.promo ? Number(await getSetting<number>("promo_points", 3)) : 1;

    const [row] = await sql<{ result: { expires_at: string; points: number } }[]>`
      SELECT api_issue_token(${branchId}, ${sess.sid}, ${code},
                             ${body.order_ref ?? null}, ${points}) AS result`;

    return json({
      ok: true,
      code,
      url: liffUrl({ t: code }),
      expires_at: row.result.expires_at,
      points: row.result.points,
    });
  });
}

import { sql } from "@/lib/db";
import { requireStaff, branchOf } from "@/lib/auth/staff";
import { newCode, liffUrl } from "@/lib/codes";
import { json, handler } from "@/lib/http";

/**
 * พนักงานกด "ออก QR"
 *
 * ส่ง campaign_id มาเมื่อเป็น QR โปรโมชั่น — **จำนวนดวงอ่านจากตัวโปรโมชั่น
 * ข้างในฟังก์ชัน Postgres เลย ไม่รับตัวเลขจากฝั่งเบราว์เซอร์**
 * ไม่งั้นใครแก้คำขอก็ขอกี่ดวงก็ได้ · โปรฯ ที่ปิดแล้วออก QR ไม่ได้
 *
 * ยิง SQL คำสั่งเดียวเท่านั้น — เดิมอ่านจำนวนดวงด้วย getSetting() ก่อน
 * แล้วค่อยออก token เป็นคำสั่งที่สอง ซึ่งบน Workers = สองตัวเชื่อมต่อคำขอ
 * แล้วค้างไม่ตอบราว 7 ใน 10 ครั้ง (ดู lib/db.ts) ห้ามเติม sql`` ตัวที่สองที่นี่
 *
 * เลขบิลไม่บังคับ — สาขาที่ไม่มี POS ส่วนใหญ่ไม่มีเลขบิลจะให้ใส่
 */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff();
    const body = (await req.json().catch(() => ({}))) as {
      order_ref?: string;
      branch_id?: string;
      campaign_id?: string;
    };
    const branchId = await branchOf(sess, body.branch_id);
    const code = newCode();

    const [row] = await sql<{
      result: {
        ok: boolean; reason?: string; expires_at: string; points: number;
        promo_name: string | null; once_per_customer: boolean | null;
      };
    }[]>`
      SELECT api_issue_token(${branchId}, ${sess.sid}, ${code},
                             ${body.order_ref ?? null}, ${body.campaign_id ?? null}) AS result`;

    // โปรฯ ถูกปิดหรือถูกลบระหว่างที่พนักงานเปิดหน้าค้างไว้ — ยังไม่มี token ถูกสร้าง
    if (!row.result.ok) return json(row.result, 400);

    return json({
      ok: true,
      code,
      url: liffUrl({ t: code }),
      expires_at: row.result.expires_at,
      points: row.result.points,
      promo_name: row.result.promo_name ?? null,
      once_per_customer: row.result.once_per_customer ?? null,
    });
  });
}

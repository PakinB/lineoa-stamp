import { sql } from "@/lib/db";
import { requireStaff, branchOf } from "@/lib/auth/staff";
import { newCode, liffUrl } from "@/lib/codes";
import { json, handler } from "@/lib/http";

/**
 * พนักงานกด "ออก QR"
 *
 * ปกติให้ 1 ดวงต่อบิล · ถ้าส่ง points มาจะเป็น QR โปรโมชั่นที่ให้หลายดวง
 * ใช้ตอนลูกค้าทำเงื่อนไขโปรโมชั่นหน้างานครบแล้ว
 *
 * เพดานอยู่ในฐานข้อมูล (1–10) ฝั่งนี้ไม่ต้องตรวจซ้ำ
 * เลขบิลไม่บังคับ — สาขาที่ไม่มี POS ส่วนใหญ่ไม่มีเลขบิลจะให้ใส่
 */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff();
    const body = (await req.json().catch(() => ({}))) as {
      order_ref?: string;
      branch_id?: string;
      points?: number;
    };
    const branchId = await branchOf(sess, body.branch_id);
    const code = newCode();

    const [row] = await sql<{ result: { expires_at: string; points: number } }[]>`
      SELECT api_issue_token(${branchId}, ${sess.sid}, ${code},
                             ${body.order_ref ?? null}, ${body.points ?? 1}) AS result`;

    return json({
      ok: true,
      code,
      url: liffUrl({ t: code }),
      expires_at: row.result.expires_at,
      points: row.result.points,
    });
  });
}

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

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_shift_summary(${branchId}) AS result`;
    return json(row.result);
  });
}

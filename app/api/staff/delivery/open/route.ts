import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/**
 * เปิด/ปิดรับออเดอร์
 *
 * ปุ่มที่ต้องกดได้ทันทีตอนครัวแน่น จึงให้พนักงานธรรมดากดได้ ไม่ต้องรอเจ้าของ
 * ทุกครั้งที่กดบันทึกลง audit_logs ว่าใครกดเมื่อไหร่
 */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff();
    const body = (await req.json()) as { open?: boolean };

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_staff_delivery_set_open(${sess.sid}, ${body.open === true}) AS result`;
    return json(row.result);
  });
}

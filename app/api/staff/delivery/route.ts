import { sql } from "@/lib/db";
import { requireStaff, branchOf } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/** คิวออเดอร์ของสาขา พร้อมตัวนับทุกแท็บในคำขอเดียว */
export async function GET() {
  return handler(async () => {
    const sess = await requireStaff();
    const branchId = await branchOf(sess);

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_staff_delivery_queue(${branchId}) AS result`;
    return json(row.result);
  });
}

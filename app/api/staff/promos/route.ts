import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/** โปรโมชั่นที่เปิดอยู่ สำหรับให้พนักงานเลือกก่อนออก QR */
export async function GET() {
  return handler(async () => {
    await requireStaff();

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_staff_promo_campaigns() AS result`;

    return json(row.result);
  });
}

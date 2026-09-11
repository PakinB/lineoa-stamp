import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/** ดึงสถิติภาพรวมสำหรับแดชบอร์ดแอดมิน */
export async function GET() {
  return handler(async () => {
    await requireStaff("owner");

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_admin_stats() AS result`;

    return json(row.result);
  });
}

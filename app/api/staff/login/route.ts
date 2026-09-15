import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { loginWithStaffPin } from "@/lib/auth/staff";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { json, handler } from "@/lib/http";

/** ดึงรายชื่อพนักงานที่เข้ากะได้สำหรับแสดงในหน้าเลือกชื่อ */
export async function GET() {
  return handler(async () => {
    const [row] = await sql<{ list: unknown }[]>`
      SELECT api_staff_list_for_login() AS list`;
    return json({ ok: true, staff: row.list });
  });
}

/** เข้ากะด้วยการเลือกชื่อ + PIN 6 หลักเท่านั้น */
export async function POST(req: Request) {
  return handler(async () => {
    const body = (await req.json()) as { staff_id?: string; pin?: string };
    if (!body.staff_id) return json({ ok: false, reason: "staff_id_required" }, 400);
    const pin = body.pin ?? "";

    const { token, staff } = await loginWithStaffPin(body.staff_id, pin);

    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 14 * 3600,
    });
    return json({ ok: true, name: staff.name, role: staff.role, branch_id: staff.branch_id });
  });
}

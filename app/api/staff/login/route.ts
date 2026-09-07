import { cookies } from "next/headers";
import { loginWithPin } from "@/lib/auth/staff";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { json, handler } from "@/lib/http";

/** เข้ากะด้วย PIN 6 หลัก เซสชันอยู่ยาวทั้งกะ ไม่ต้องใส่ซ้ำทุกบิล (§4) */
export async function POST(req: Request) {
  return handler(async () => {
    const { pin } = (await req.json()) as { pin?: string };
    const { token, staff } = await loginWithPin(pin ?? "");

    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 14 * 3600,
    });
    return json({ ok: true, name: staff.name, role: staff.role, branch_id: staff.branch_id });
  });
}

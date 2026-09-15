import { requireStaff } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/**
 * ยืนยัน session ก่อนหน้าจอ QR จะออก token
 *
 * ใช้ route handler เดียวกับ API ออก QR เพื่อให้บน Cloudflare อ่าน secret
 * จาก runtime เดียวกัน และไม่พึ่ง App Router cache ฝั่งเบราว์เซอร์
 */
export async function GET() {
  return handler(async () => {
    const session = await requireStaff();
    return json({ ok: true, role: session.role });
  });
}

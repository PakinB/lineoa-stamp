import { requireStaff } from "@/lib/auth/staff";
import { getSetting } from "@/lib/settings";
import { json, handler } from "@/lib/http";

/**
 * ยืนยัน session ก่อนหน้าจอ QR จะออก token
 *
 * ใช้ route handler เดียวกับ API ออก QR เพื่อให้บน Cloudflare อ่าน secret
 * จาก runtime เดียวกัน และไม่พึ่ง App Router cache ฝั่งเบราว์เซอร์
 *
 * คืน promo_points มาด้วย เพื่อให้หน้าพนักงานแสดงจำนวนดวงตรงกับที่
 * เซิร์ฟเวอร์จะปั๊มจริง — เปลี่ยนค่าในหน้าแอดมินแล้วมีผลทันทีโดยไม่ต้อง deploy
 */
export async function GET() {
  return handler(async () => {
    const session = await requireStaff();
    const promoPoints = await getSetting<number>("promo_points", 3);
    return json({ ok: true, role: session.role, promo_points: Number(promoPoints) });
  });
}

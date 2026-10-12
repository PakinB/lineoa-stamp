import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, fail, handler } from "@/lib/http";

/**
 * ลูกค้าแนบสลิปโอนเงิน
 *
 * รูปถูกย่อในมือถือลูกค้าก่อนส่งมา (ดู components/DeliveryOrder.tsx)
 * ฐานข้อมูลปฏิเสธถ้าเกิน 200 KB
 *
 * `ref` คือเลขอ้างอิงที่อ่านจาก QR ท้ายสลิป — ใช้กันส่งสลิปใบเดิมซ้ำ
 * ไม่ได้ยืนยันว่าเงินเข้าจริง ตัวนั้นพนักงานดูจากแอปธนาคาร
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const { id } = await ctx.params;
    const body = (await req.json()) as { image?: string; mime?: string; ref?: string };

    if (!body.image) return fail("image_required", 400);

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_delivery_upload_slip(${me.userId}, ${id}, ${body.image},
                                      ${body.mime ?? "image/jpeg"}, ${body.ref ?? null}) AS result`;
    return json(row.result, row.result.ok ? 200 : 400);
  });
}

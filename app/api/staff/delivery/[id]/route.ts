import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/** ดูรูปสลิปของออเดอร์ — คืน base64 ให้หน้าเว็บวาด */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireStaff();
    const { id } = await ctx.params;

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_staff_delivery_slip(${id}) AS result`;
    return json(row.result, row.result.ok ? 200 : 404);
  });
}

/**
 * เลื่อนสถานะ หรือยืนยันการชำระเงิน
 *
 * ลำดับสถานะบังคับที่ฐานข้อมูล ข้ามขั้นไม่ได้ และออเดอร์ที่โอนมาจะกดรับไม่ได้
 * จนกว่าจะมีคนยืนยันว่าเงินเข้า — ไม่ใช่แค่ซ่อนปุ่มในหน้าเว็บ
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const sess = await requireStaff();
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      action?: "advance" | "payment";
      to?: string;
      rider_id?: string;
      reason?: string;
      ok?: boolean;
    };

    if (body.action === "payment") {
      const [row] = await sql<{ result: { ok: boolean } }[]>`
        SELECT api_staff_delivery_confirm_payment(
          ${id}, ${sess.sid}, ${body.ok === true}, ${body.reason ?? null}) AS result`;
      return json(row.result, row.result.ok ? 200 : 400);
    }

    if (!body.to) return fail("to_required", 400);

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_staff_delivery_advance(
        ${id}, ${sess.sid}, ${body.to},
        ${body.rider_id ?? sess.sid}, ${body.reason ?? null}) AS result`;
    return json(row.result, row.result.ok ? 200 : 400);
  });
}

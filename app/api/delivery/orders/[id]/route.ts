import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, handler } from "@/lib/http";

/** ลูกค้าดูสถานะออเดอร์ตัวเอง — หน้านี้ poll ทุกไม่กี่วินาทีตอนเปิดค้างไว้ */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const { id } = await ctx.params;

    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_delivery_my_order(${me.userId}, ${id}) AS result`;
    return json(row.result, row.result.ok ? 200 : 404);
  });
}

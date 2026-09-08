import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, handler } from "@/lib/http";

type P = { params: Promise<{ code: string }> };

/** ลูกค้าสแกน QR ของพนักงาน — เห็นสิทธิ์ที่ใช้ได้ ยังไม่ตัดอะไร */
export async function GET(req: Request, { params }: P) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const { code } = await params;
    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_list_redeemable(${me.userId}, ${me.displayName}, ${me.pictureUrl}, ${code})
             AS result`;
    return json(row.result, row.result.ok ? 200 : 410);
  });
}

/**
 * ลูกค้าแตะเลือกสิทธิ์ — ใช้ทันที ไม่มี dialog ยืนยัน (§4)
 * การยืนยันคือการที่พนักงานส่งของให้ ไม่ใช่ปุ่มบนหน้าจอ
 */
export async function POST(req: Request, { params }: P) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const { code } = await params;
    const b = (await req.json()) as { entitlement_id?: string; option_id?: string };
    if (!b.entitlement_id) return json({ ok: false, reason: "entitlement_not_available" }, 400);

    try {
      const [row] = await sql<{ result: { ok: boolean } }[]>`
        SELECT api_redeem(${me.userId}, ${me.displayName}, ${me.pictureUrl},
                          ${code}, ${b.entitlement_id}, ${b.option_id ?? null}) AS result`;
      return json(row.result, row.result.ok ? 200 : 409);
    } catch (e) {
      // ฟังก์ชันใน DB โยน exception เพื่อม้วนกลับทั้งทรานแซกชัน จะได้ไม่เผา QR ทิ้ง
      const msg = (e as { message?: string }).message ?? "";
      for (const r of ["entitlement_not_available", "option_required", "invalid_option"]) {
        if (msg.includes(r)) return json({ ok: false, reason: r }, 409);
      }
      throw e;
    }
  });
}

import { sql } from "@/lib/db";
import { requireCustomer } from "@/lib/auth/line";
import { json, handler } from "@/lib/http";

/** สถานะบัตรของลูกค้า — คืนข้อมูล "พร้อมวาด" ทั้งหมด (§14) */
export async function GET(req: Request) {
  return handler(async () => {
    const me = await requireCustomer(req);
    const [row] = await sql<{ state: unknown }[]>`
      SELECT get_card_state(${me.id}) AS state`;
    return json({ ok: true, ...(row.state as object), consented: !!me.consent_at });
  });
}

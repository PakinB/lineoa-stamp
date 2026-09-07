import { sql } from "@/lib/db";
import { requireCustomer } from "@/lib/auth/line";
import { json, handler } from "@/lib/http";

/** บันทึกการยินยอมตาม PDPA (§13) — บันทึกเวลาไว้เป็นหลักฐาน */
export async function POST(req: Request) {
  return handler(async () => {
    const me = await requireCustomer(req);
    await sql`
      UPDATE customers SET consent_at = COALESCE(consent_at, now())
       WHERE id = ${me.id}`;
    return json({ ok: true });
  });
}

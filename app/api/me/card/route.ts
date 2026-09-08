import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, handler } from "@/lib/http";

/** สถานะบัตร — อัปเสิร์ตลูกค้าและอ่านบัตรในคำสั่งเดียว (ดู 0003_api.sql) */
export async function GET(req: Request) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT api_get_card(${me.userId}, ${me.displayName}, ${me.pictureUrl}) AS result`;
    return json(row.result, row.result.ok ? 200 : 403);
  });
}

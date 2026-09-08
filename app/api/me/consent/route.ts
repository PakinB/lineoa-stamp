import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, handler } from "@/lib/http";

/** บันทึกการยินยอมตาม PDPA (§13) */
export async function POST(req: Request) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_consent(${me.userId}, ${me.displayName}, ${me.pictureUrl}) AS result`;
    return json(row.result);
  });
}

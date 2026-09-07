import { sql } from "@/lib/db";
import { requireStaff, branchOf } from "@/lib/auth/staff";
import { newCode, liffUrl } from "@/lib/codes";
import { json, handler } from "@/lib/http";

/** พนักงานกด "รับรางวัล" → ได้ QR ไว้โชว์ ท่าเดียวกับตอนออก QR สะสม (§4) */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff();
    const body = (await req.json().catch(() => ({}))) as { branch_id?: string };
    const branchId = await branchOf(sess, body.branch_id);
    const code = newCode();

    const [row] = await sql<{ result: { expires_at: string } }[]>`
      SELECT issue_redeem_token(${branchId}, ${sess.sid}, ${code}) AS result`;

    return json({ ok: true, code, url: liffUrl({ r: code }), expires_at: row.result.expires_at });
  });
}

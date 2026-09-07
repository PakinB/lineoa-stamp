import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/** จอพนักงาน poll เส้นนี้ แล้วขึ้น "✓ ให้โค้กฟรี กับคุณพิมพ์" เอง */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handler(async () => {
    await requireStaff();
    const { code } = await params;

    const rows = await sql<{
      status: string; name: string | null; given: string | null; ent: string | null;
    }[]>`
      SELECT t.status,
             c.display_name AS name,
             o.name         AS given,
             t.entitlement_id::text AS ent
        FROM redeem_tokens t
        LEFT JOIN customers c    ON c.id = t.consumed_by
        LEFT JOIN entitlements e ON e.id = t.entitlement_id
        LEFT JOIN reward_options o ON o.id = e.chosen_option_id
       WHERE t.code = ${code}`;

    if (rows.length === 0) return fail("not_found", 404);
    const r = rows[0];
    return json({
      ok: true,
      redeemed: r.status === "consumed",
      customer_name: r.name,
      given: r.given,
      entitlement_id: r.ent,   // ใช้ต่อกับปุ่ม "คืนสิทธิ์" ถ้าลูกค้ากดพลาด
    });
  });
}

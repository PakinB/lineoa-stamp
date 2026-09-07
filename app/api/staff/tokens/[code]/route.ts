import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/**
 * หน้า QR ของพนักงานเรียกเส้นนี้ทุก 2 วินาที
 *
 * §4 — จุดที่มักออกแบบพลาด: ถ้าจอพนักงานไม่บอกว่าลูกค้าสแกนสำเร็จหรือยัง
 * พนักงานจะไม่กล้าเก็บจอ ต้องยืนถามลูกค้าทุกครั้งจนคิวติด
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handler(async () => {
    await requireStaff();
    const { code } = await params;

    const rows = await sql<{ status: string; name: string | null; slot: number | null }[]>`
      SELECT t.status,
             c.display_name AS name,
             l.slot_no      AS slot
        FROM earn_tokens t
        LEFT JOIN customers c   ON c.id = t.consumed_by
        LEFT JOIN stamp_ledger l ON l.idempotency_key = 'token:' || t.code
       WHERE t.code = ${code}`;

    if (rows.length === 0) return fail("not_found", 404);
    const r = rows[0];
    return json({
      ok: true,
      claimed: r.status === "consumed",
      expired: r.status === "expired",
      customer_name: r.name,
      slot_no: r.slot,
    });
  });
}

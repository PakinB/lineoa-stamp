import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/**
 * คืนสิทธิ์เมื่อลูกค้ากดพลาด — ได้ภายใน 10 นาที (ตั้งค่าได้)
 *
 * §4: แทนที่จะเอา dialog "แน่ใจไหม?" ไปขวางทุกคนเพื่อกันคนส่วนน้อยที่กดพลาด
 * ให้แก้ทีหลังได้แทน ทางเดินปกติจึงไม่มีอะไรมาขวาง
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const sess = await requireStaff();
    const { id } = await params;
    const [row] = await sql<{ result: { ok: boolean } }[]>`
      SELECT void_redemption(${id}, ${sess.sid}) AS result`;
    return json(row.result, row.result.ok ? 200 : 409);
  });
}

import { sql } from "@/lib/db";
import { getLimit } from "@/lib/settings";
import { HttpError } from "@/lib/http";

/**
 * เพดานการสะสม
 *
 * ปัจจุบันเปิดไว้ไม่จำกัดทั้งคู่ (§6) — ลูกค้าซื้อ 10 ออเดอร์ได้ 10 ดวง
 * เพราะทุกดวงต้องมีพนักงานกดออก QR จากบิลจริงอยู่แล้ว จึงจำกัดตัวเองในตัว
 *
 * โค้ดนี้ต้องรองรับค่า null = ไม่จำกัด ให้ถูก ห้ามเผลอแปลง null เป็น 0
 * ไม่งั้นจะกลายเป็นห้ามสะสมเลย
 */
export async function assertCanEarn(customerId: string, branchId: string | null) {
  const perDay = await getLimit("max_stamps_per_day");
  if (perDay !== null) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM stamp_ledger
       WHERE customer_id = ${customerId}
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                           AT TIME ZONE 'Asia/Bangkok'`;
    if (n >= perDay) throw new HttpError("rate_limited", 429);
  }

  const cooldown = await getLimit("cooldown_minutes");
  if (cooldown !== null && branchId) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM stamp_ledger
       WHERE customer_id = ${customerId} AND branch_id = ${branchId}
         AND created_at > now() - make_interval(mins => ${cooldown})`;
    if (n > 0) throw new HttpError("rate_limited", 429);
  }
}

/** เดลิเวอรี่ยังคุมไว้ เพราะรูปใบเสร็จไม่ได้ผูกกับการกดของพนักงาน */
export async function assertCanClaimDelivery(customerId: string) {
  const perWeek = await getLimit("max_delivery_per_week");
  if (perWeek === null) return;
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM delivery_claims
     WHERE customer_id = ${customerId}
       AND status <> 'rejected'
       AND created_at > now() - interval '7 days'`;
  if (n >= perWeek) throw new HttpError("rate_limited", 429);
}

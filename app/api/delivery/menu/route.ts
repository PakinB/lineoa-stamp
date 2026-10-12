import { sql } from "@/lib/db";
import { requireIdentity } from "@/lib/auth/line";
import { json, handler } from "@/lib/http";

/**
 * ทุกอย่างที่หน้าแรกของ LIFF ต้องใช้ในคำขอเดียว
 *
 * ริชเมนูมีช่องเดียว หน้านี้จึงตอบทั้ง "มีออเดอร์ค้างอยู่ไหม" และ
 * "สั่งอะไรได้บ้าง" พร้อมกัน — ดู active_order ในผลลัพธ์
 */
export async function GET(req: Request) {
  return handler(async () => {
    const me = await requireIdentity(req);
    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_delivery_menu(${me.userId}, ${me.displayName}, ${me.pictureUrl}) AS result`;
    return json(row.result);
  });
}

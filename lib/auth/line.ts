import { sql } from "@/lib/db";
import { HttpError } from "@/lib/http";

/**
 * ตรวจตัวตนลูกค้าจาก LIFF access token
 *
 * §6 — ช่องโหว่ที่พบบ่อยที่สุดในระบบที่ทำบน LIFF:
 * ห้ามรับ lineUserId จาก request body แล้วเชื่อเลย ใครก็ปลอมได้ในสามวินาที
 * ต้องเอา access token ไปแลกตัวตนกับ LINE ทุกครั้ง
 *
 * และต้องตรวจ client_id ด้วย ไม่ใช่แค่เรียก /v2/profile ให้ผ่าน —
 * เพราะ token ที่ออกจาก LINE Login channel "ของคนอื่น" ก็เรียก /v2/profile ได้
 * ถ้าไม่เช็ค ใครก็สร้าง channel ของตัวเองแล้วยิงเข้าระบบเราได้
 */

interface LineProfile {
  userId: string;
  displayName?: string;
  pictureUrl?: string;
}

export async function verifyLiffToken(token: string): Promise<LineProfile> {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) throw new Error("ไม่พบ LINE_LOGIN_CHANNEL_ID");

  const vRes = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`
  );
  if (!vRes.ok) throw new HttpError("unauthenticated", 401);

  const v = (await vRes.json()) as { client_id?: string; expires_in?: number };
  if (v.client_id !== channelId) throw new HttpError("unauthenticated", 401);
  if (!v.expires_in || v.expires_in <= 0) throw new HttpError("unauthenticated", 401);

  const pRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!pRes.ok) throw new HttpError("unauthenticated", 401);

  const p = (await pRes.json()) as LineProfile;
  if (!p.userId) throw new HttpError("unauthenticated", 401);
  return p;
}

export interface Customer {
  id: string;
  line_user_id: string;
  display_name: string | null;
  consent_at: Date | null;
  blocked_at: Date | null;
}

/**
 * หาลูกค้าจาก LINE userId ถ้ายังไม่มีให้สร้างเลย
 *
 * §4: ลูกค้าใหม่ไม่ต้องกรอกฟอร์มอะไรทั้งนั้น บัญชีเกิดเงียบ ๆ ตอนสแกนครั้งแรก
 * ส่วนบัตรใบแรกปล่อยให้ award_stamp เปิดให้เอง จะได้มีที่เดียวที่เปิดบัตร
 */
export async function getOrCreateCustomer(p: LineProfile): Promise<Customer> {
  const rows = await sql<Customer[]>`
    INSERT INTO customers (line_user_id, display_name, picture_url)
    VALUES (${p.userId}, ${p.displayName ?? null}, ${p.pictureUrl ?? null})
    ON CONFLICT (line_user_id) DO UPDATE
      SET display_name = COALESCE(EXCLUDED.display_name, customers.display_name),
          picture_url  = COALESCE(EXCLUDED.picture_url,  customers.picture_url)
    RETURNING id, line_user_id, display_name, consent_at, blocked_at`;

  const c = rows[0];
  if (c.blocked_at) throw new HttpError("account_blocked", 403);
  return c;
}

/** ดึงตัวตนลูกค้าจาก Authorization: Bearer <LIFF access token> */
export async function requireCustomer(req: Request): Promise<Customer> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) throw new HttpError("unauthenticated", 401);
  return getOrCreateCustomer(await verifyLiffToken(token));
}

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

/**
 * ตัวตนลูกค้าที่ใช้ยิงเข้าฟังก์ชัน api_* ทั้งหลาย
 *
 * ไม่แตะฐานข้อมูลที่นี่ — การอัปเสิร์ตลูกค้าไปรวมอยู่ในคำสั่ง SQL คำสั่งเดียว
 * กับงานจริงของแต่ละเส้นทาง (ดู db/migrations/0003_api.sql)
 * เพราะ Workers เปิดตัวเชื่อมสองตัวในคำขอเดียวไม่ได้
 */
export interface LineIdentity {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
}

function devIdentity(): LineIdentity | null {
  if (process.env.NODE_ENV === "production") return null;
  const uid = process.env.DEV_FAKE_LINE_USER;
  if (!uid) return null;
  return {
    userId: uid,
    displayName: process.env.DEV_FAKE_LINE_NAME ?? "ลูกค้าทดสอบ",
    pictureUrl: null,
  };
}

/** ดึงตัวตนลูกค้าจาก Authorization: Bearer <LIFF access token> */
export async function requireIdentity(req: Request): Promise<LineIdentity> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    const dev = devIdentity();
    if (dev) return dev;
    throw new HttpError("unauthenticated", 401);
  }
  const p = await verifyLiffToken(token);
  return {
    userId: p.userId,
    displayName: p.displayName ?? null,
    pictureUrl: p.pictureUrl ?? null,
  };
}

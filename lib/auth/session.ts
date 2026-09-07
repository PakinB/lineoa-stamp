import { HttpError } from "@/lib/http";

/**
 * เซสชันพนักงาน — คุกกี้ที่เซ็นด้วย HMAC
 *
 * ใช้ Web Crypto ล้วน ไม่พึ่งไลบรารีภายนอกและรันได้ทั้งบน Node และ edge runtime
 * เก็บเฉพาะข้อมูลที่ไม่เป็นความลับ (id, สาขา, บทบาท) ลายเซ็นกันการแก้ไข
 */

const enc = new TextEncoder();

export interface StaffSession {
  sid: string;      // staff_users.id
  bid: string | null; // branch_id (owner เป็น null = ทุกสาขา)
  role: "staff" | "manager" | "owner";
  exp: number;      // unix seconds
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(p + "=".repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

async function key(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ต้องตั้ง SESSION_SECRET อย่างน้อย 32 ตัวอักษร");
  }
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign", "verify"]);
}

export async function signSession(s: StaffSession): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function readSession(token: string | undefined): Promise<StaffSession> {
  if (!token) throw new HttpError("unauthenticated", 401);
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new HttpError("unauthenticated", 401);

  const ok = await crypto.subtle.verify(
    "HMAC", await key(), unb64url(sig) as BufferSource, enc.encode(body));
  if (!ok) throw new HttpError("unauthenticated", 401);

  const s = JSON.parse(new TextDecoder().decode(unb64url(body))) as StaffSession;
  if (s.exp < Math.floor(Date.now() / 1000)) throw new HttpError("session_expired", 401);
  return s;
}

export const SESSION_COOKIE = "mala_staff";

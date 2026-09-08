import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { readSession, signSession, SESSION_COOKIE, type StaffSession } from "@/lib/auth/session";

/**
 * PIN พนักงาน
 *
 * ใช้ PBKDF2 ผ่าน Web Crypto แทน bcrypt เพราะ bcrypt เป็น native module
 * ที่รันบน edge runtime ไม่ได้ และเราตั้งใจจะ deploy บน Cloudflare Workers (§7)
 *
 * จำนวนรอบต้องไม่เกิน 100,000 เพราะ Cloudflare Workers ปฏิเสธค่าที่สูงกว่านั้น
 * (NotSupportedError: iteration counts above 100000 are not supported)
 * ถ้าเพิ่มเกินนี้จะ build ผ่านแต่พังตอนรันบนของจริงเท่านั้น
 *
 * PIN 6 หลักมีแค่ล้านความเป็นไปได้ ลำพัง hash จึงไม่พอ
 * แนวป้องกันจริงคือการจำกัดจำนวนครั้งที่เดาผิด ซึ่งยังไม่ได้ทำ ดู README
 */

const ITERATIONS = 100_000;
const enc = new TextEncoder();

function hex(b: Uint8Array) { return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function unhex(s: string) {
  return new Uint8Array(s.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

async function derive(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" }, k, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${hex(salt)}$${hex(await derive(pin, salt))}`;
}

/** เทียบแบบเวลาคงที่ ไม่ให้เดาจากเวลาที่ใช้ตอบ */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function checkPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, want] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const k = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: unhex(salt) as BufferSource, iterations: Number(iter), hash: "SHA-256" },
    k, 256);
  return sameBytes(new Uint8Array(bits), unhex(want));
}

interface StaffRow {
  id: string; branch_id: string | null; name: string;
  role: "staff" | "manager" | "owner"; pin_hash: string;
}

/**
 * ล็อกอินด้วย PIN
 *
 * ไม่มีชื่อผู้ใช้ — ไล่เทียบ PIN กับพนักงานทุกคนที่ยังไม่ถูกเพิกถอน
 * แลกความสะดวกหน้าร้านกับการที่ PIN ต้องไม่ซ้ำกันในระบบ (ตรวจตอนสร้าง)
 */
export async function loginWithPin(pin: string): Promise<{ token: string; staff: StaffRow }> {
  if (!/^\d{6}$/.test(pin)) throw new HttpError("invalid_pin", 401);

  const rows = await sql<StaffRow[]>`
    SELECT id, branch_id, name, role, pin_hash
      FROM staff_users WHERE revoked_at IS NULL`;

  for (const s of rows) {
    if (await checkPin(pin, s.pin_hash)) {
      const hours = 14; // ครอบคลุมหนึ่งกะเต็ม ไม่ต้องใส่ PIN ซ้ำทุกบิล
      const sess: StaffSession = {
        sid: s.id, bid: s.branch_id, role: s.role,
        exp: Math.floor(Date.now() / 1000) + hours * 3600,
      };
      return { token: await signSession(sess), staff: s };
    }
  }
  throw new HttpError("invalid_pin", 401);
}

export async function requireStaff(minRole: "staff" | "manager" | "owner" = "staff") {
  const jar = await cookies();
  const sess = await readSession(jar.get(SESSION_COOKIE)?.value);
  const rank = { staff: 0, manager: 1, owner: 2 };
  if (rank[sess.role] < rank[minRole]) throw new HttpError("forbidden", 403);
  return sess;
}

/** สาขาที่เซสชันนี้ทำงานอยู่ — owner ไม่ผูกสาขา ต้องระบุมาเอง */
export async function branchOf(sess: StaffSession, given?: string | null): Promise<string> {
  const b = sess.bid ?? given ?? null;
  if (!b) throw new HttpError("branch_required", 400);
  return b;
}

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

export interface StaffAuthResult {
  token: string;
  staff: {
    id: string;
    name: string;
    role: "staff" | "manager" | "owner";
    branch_id: string | null;
  };
}

/**
 * ล็อกอินด้วยการเลือกชื่อ + PIN 6 หลัก
 *
 * 1. ตรวจสอบว่าถูกระงับ (locked_until) หรือไม่
 * 2. พนักงาน (staff) อนุญาตให้ล็อกอินได้เฉพาะช่วงเวลาทำงาน 11:00 - 22:00 น.
 * 3. บันทึก failed_attempts เมื่อใส่ผิด หากถึงเพดานจะล็อกบัญชี 15 นาที
 */
export async function loginWithStaffPin(staffId: string, pin: string): Promise<StaffAuthResult> {
  if (!/^\d{6}$/.test(pin)) throw new HttpError("invalid_pin", 400);

  const [row] = await sql<{
    result: {
      ok: boolean;
      id: string;
      name: string;
      role: "staff" | "manager" | "owner";
      branch_id: string | null;
      pin_hash: string;
      failed_attempts: number;
      is_locked: boolean;
      locked_until: string | null;
      shift_start: number;
      shift_end: number;
      is_working_hours: boolean;
      max_attempts: number;
      lockout_minutes: number;
      reason?: string;
    };
  }[]>`SELECT api_staff_auth_info(${staffId}) AS result`;

  const info = row?.result;
  if (!info || !info.ok) throw new HttpError("staff_not_found", 404);

  if (info.is_locked) throw new HttpError("account_locked", 403);

  // พนักงาน (role === 'staff') เข้ากะได้เฉพาะเวลาทำงาน 11:00 - 22:00 น.
  if (info.role === "staff" && !info.is_working_hours) {
    throw new HttpError("outside_working_hours", 403);
  }

  const ok = await checkPin(pin, info.pin_hash);
  if (!ok) {
    await sql`SELECT api_staff_record_login_failure(${staffId})`;
    throw new HttpError("invalid_pin", 401);
  }

  if (info.failed_attempts > 0) {
    await sql`SELECT api_staff_record_login_success(${staffId})`;
  }

  const hours = 14;
  const sess: StaffSession = {
    sid: info.id,
    bid: info.branch_id,
    role: info.role,
    exp: Math.floor(Date.now() / 1000) + hours * 3600,
  };

  return {
    token: await signSession(sess),
    staff: { id: info.id, name: info.name, role: info.role, branch_id: info.branch_id },
  };
}

export async function requireStaff(minRole: "staff" | "manager" | "owner" = "staff") {
  const jar = await cookies();
  const sess = await readSession(jar.get(SESSION_COOKIE)?.value);
  const rank = { staff: 0, manager: 1, owner: 2 };
  if (rank[sess.role] < rank[minRole]) throw new HttpError("forbidden", 403);
  return sess;
}

/** สาขาที่เซสชันนี้ทำงานอยู่ — ถ้าเป็น owner ที่ไม่ได้ผูกสาขา ให้เป็น null แล้วให้ DB เลือกสาขาหลักอัตโนมัติ */
export async function branchOf(sess: StaffSession, given?: string | null): Promise<string | null> {
  return sess.bid ?? given ?? null;
}

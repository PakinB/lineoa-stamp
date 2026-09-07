/**
 * เพิ่มพนักงานพร้อม PIN
 *   node scripts/create-staff.mjs "ชื่อ" <pin 6 หลัก> <staff|manager|owner> [branch_code]
 *
 * ใช้ PBKDF2 สูตรเดียวกับ lib/auth/staff.ts เป๊ะ ๆ ถ้าแก้ที่นั่นต้องแก้ที่นี่ด้วย
 */
import postgres from "postgres";
import { webcrypto as crypto } from "node:crypto";

const ITERATIONS = 210_000;
const enc = new TextEncoder();
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const k = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, k, 256);
  return `pbkdf2$${ITERATIONS}$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

const [name, pin, role = "staff", branchCode] = process.argv.slice(2);
if (!name || !/^\d{6}$/.test(pin ?? "")) {
  console.error('ใช้: node scripts/create-staff.mjs "ชื่อ" <pin 6 หลัก> [role] [branch_code]');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const hash = await hashPin(pin);

// PIN ต้องไม่ซ้ำกันในระบบ เพราะล็อกอินไม่มีชื่อผู้ใช้ ใช้ PIN อย่างเดียว
for (const s of await sql`SELECT pin_hash FROM staff_users WHERE revoked_at IS NULL`) {
  const [, iter, salt, want] = s.pin_hash.split("$");
  const k = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: Uint8Array.from(salt.match(/.{2}/g).map((h) => parseInt(h, 16))),
      iterations: Number(iter), hash: "SHA-256" }, k, 256);
  if (hex(new Uint8Array(bits)) === want) {
    console.error("PIN นี้มีคนใช้แล้ว เลือกเลขอื่น");
    process.exit(1);
  }
}

const [row] = await sql`
  INSERT INTO staff_users (name, role, pin_hash, branch_id)
  VALUES (${name}, ${role}, ${hash},
          ${branchCode ? sql`(SELECT id FROM branches WHERE code = ${branchCode})` : null})
  RETURNING id, name, role`;
console.log("เพิ่มแล้ว:", row);
await sql.end();

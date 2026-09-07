/**
 * โหลด .env.local เข้า process.env
 *
 * จำเป็นเพราะคำสั่ง db:* เรียก psql ตรง ๆ ซึ่งไม่ใช่ Next.js
 * จึงไม่มีใครโหลด .env.local ให้ — เป็นจุดที่สะดุดกันบ่อยตอนตั้งเครื่องครั้งแรก
 */
import { readFileSync, existsSync } from "node:fs";

export function loadEnv(file = ".env.local") {
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // รองรับค่าที่ใส่เครื่องหมายคำพูดไว้ (จำเป็นถ้ารหัสผ่านมีอักขระพิเศษ)
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
  return true;
}

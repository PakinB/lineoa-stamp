/** รัน psql โดยโหลด .env.local ให้ก่อน — ใช้โดยคำสั่ง npm run db:* */
import { spawnSync } from "node:child_process";
import { loadEnv } from "./load-env.mjs";

loadEnv();
if (!process.env.DATABASE_URL) {
  console.error("ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env.local แล้วกรอกก่อน");
  process.exit(1);
}
const r = spawnSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", ...process.argv.slice(2)],
  { stdio: "inherit" });
if (r.error) {
  console.error("เรียก psql ไม่ได้ — ติดตั้งด้วย: brew install postgresql@16");
  process.exit(1);
}
process.exit(r.status ?? 1);

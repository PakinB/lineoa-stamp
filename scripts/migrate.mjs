/**
 * ตัวรัน migration ที่รันเฉพาะไฟล์ที่ยังไม่เคยรัน
 *
 * เดิมใช้ psql ยิงทุกไฟล์รวดเดียว ซึ่งใช้ได้เฉพาะฐานข้อมูลเปล่า
 * พอฐานข้อมูลมีตารางอยู่แล้ว 0001 จะ error ว่าตารางซ้ำ
 * แล้ว ON_ERROR_STOP หยุดทั้งชุด ทำให้ไฟล์ใหม่ท้าย ๆ ไม่เคยถูกรัน
 * โดยไม่มีอะไรเตือน — เจอมาแล้วกับ 0007
 *
 *   node scripts/migrate.mjs            รันเฉพาะที่ยังไม่เคยรัน
 *   node scripts/migrate.mjs --status   ดูว่าไฟล์ไหนรันแล้วบ้าง
 *   node scripts/migrate.mjs --baseline ทำเครื่องหมายว่ารันแล้วทั้งหมดโดยไม่รันจริง
 *                                       (ใช้ครั้งเดียวกับฐานข้อมูลที่มีของอยู่ก่อน)
 */
import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnv } from "./load-env.mjs";

loadEnv();
if (!process.env.DATABASE_URL) {
  console.error("ไม่พบ DATABASE_URL — สร้าง .env.local ก่อน");
  process.exit(1);
}

const mode = process.argv[2] ?? "";
const dir = "db/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

await sql`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

const done = new Set((await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename));

if (mode === "--status") {
  for (const f of files) console.log(`  ${done.has(f) ? "✓" : "⬜"} ${f}`);
  await sql.end();
  process.exit(0);
}

if (mode === "--baseline") {
  for (const f of files) {
    await sql`INSERT INTO schema_migrations (filename) VALUES (${f}) ON CONFLICT DO NOTHING`;
  }
  console.log(`ทำเครื่องหมายว่ารันแล้ว ${files.length} ไฟล์ โดยไม่ได้รันจริง`);
  await sql.end();
  process.exit(0);
}

const pending = files.filter((f) => !done.has(f));
if (pending.length === 0) {
  console.log("ไม่มี migration ใหม่ ทุกไฟล์รันครบแล้ว");
  await sql.end();
  process.exit(0);
}

for (const f of pending) {
  const body = readFileSync(`${dir}/${f}`, "utf8");
  try {
    // แต่ละไฟล์อยู่ในทรานแซกชันของตัวเอง ล้มแล้วไม่ทิ้งของค้างครึ่ง ๆ
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (filename) VALUES (${f})`;
    });
    console.log(`  ✓ ${f}`);
  } catch (e) {
    console.error(`  ❌ ${f}\n     ${e.message}`);
    await sql.end();
    process.exit(1);
  }
}
console.log(`รันเสร็จ ${pending.length} ไฟล์`);
await sql.end();

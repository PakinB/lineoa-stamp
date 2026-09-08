import postgres from "postgres";

/**
 * ตัวเชื่อมฐานข้อมูล — ใช้ไดรเวอร์บาง ๆ ไม่ใช้ ORM
 *
 * เหตุผล: ตรรกะแกนกลางอยู่ในฟังก์ชันของ Postgres (db/migrations/0002_functions.sql)
 * เพราะต้องการล็อกแถวและทรานแซกชันที่ควบคุมได้แม่นยำ ORM จะบังหน้าส่วนนั้น
 *
 * ที่มาของ connection string ต่างกันตามที่รัน:
 *   บนเครื่อง      — DATABASE_URL จาก .env.local (ต่อ Supabase pooler ตรง ๆ)
 *   บน Cloudflare  — binding HYPERDRIVE ซึ่งจัดการ pool ให้ เพราะ Worker
 *                    เปิด connection ค้างไว้ข้ามคำขอไม่ได้
 *
 * binding อ่านได้เฉพาะตอนอยู่ในคำขอ จึงต้องสร้างตัวเชื่อมแบบขี้เกียจ
 * ใช้ Proxy ห่อไว้ เพื่อให้ทุกที่ที่เรียกใช้เขียนเหมือนเดิมว่า sql`...`
 */

type Sql = ReturnType<typeof postgres>;

function connectionString(): string {
  // บน Cloudflare: เอาจาก binding
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@opennextjs/cloudflare") as {
      getCloudflareContext?: () => { env?: Record<string, unknown> };
    };
    const env = mod.getCloudflareContext?.().env;
    const hd = env?.HYPERDRIVE as { connectionString?: string } | undefined;
    if (hd?.connectionString) return hd.connectionString;
  } catch {
    // ไม่ได้รันบน Cloudflare — ตกไปใช้ค่าจาก env ตามปกติ
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env.local ก่อน");
  return url;
}

let cached: Sql | undefined;

function real(): Sql {
  if (!cached) {
    cached = postgres(connectionString(), {
      max: 5,
      idle_timeout: 20,
      // ต้องปิดเสมอ ทั้ง Supabase pooler และ Hyperdrive ทำงานแบบ transaction mode
      // ซึ่งใช้ prepared statement ข้ามคำขอไม่ได้
      prepare: false,
    });
  }
  return cached;
}

/** ใช้เหมือนเดิมทุกที่: sql`SELECT ...` */
export const sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_t, _self, args: unknown[]) =>
    (real() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => (real() as unknown as Record<string | symbol, unknown>)[prop],
}) as Sql;

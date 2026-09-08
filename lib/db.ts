import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * ตัวเชื่อมฐานข้อมูล — ใช้ไดรเวอร์บาง ๆ ไม่ใช้ ORM
 *
 * ตรรกะแกนกลางอยู่ในฟังก์ชันของ Postgres (db/migrations/0002_functions.sql)
 * เพราะต้องการล็อกแถวและทรานแซกชันที่ควบคุมได้แม่นยำ
 *
 * ── ข้อจำกัดบน Cloudflare Workers ที่กำหนดรูปร่างโค้ดนี้ ──
 *
 * Workers ผูก I/O ทุกตัวไว้กับคำขอที่สร้างมัน:
 *   - ใช้ตัวเชื่อมซ้ำข้ามคำขอ  -> คำขอถัดไปค้างแล้วไม่ตอบ
 *   - เปิดสองตัวเชื่อมในคำขอเดียว -> ล้มเหลวราว 7 ใน 10 ครั้ง
 *
 * ลองใช้ ctx เป็นกุญแจแคชแล้วไม่ได้ผล (บางคำขอ ctx เป็น undefined)
 * ลองใช้ cache() ของ React แล้วแย่กว่าเดิม (ไม่ได้ผูกกับคำขอจริงในรันไทม์นี้)
 *
 * ทางที่ใช้จริง: เปิดตัวเชื่อมใหม่ทุกคำสั่ง แล้ว **ออกแบบให้หนึ่งคำขอ
 * ยิง SQL คำสั่งเดียว** ทุกเส้นทาง — ดูคอมเมนต์ในแต่ละ route
 * ได้ผลพลอยได้คือลดรอบสื่อสารกับฐานข้อมูล ซึ่งสำคัญเพราะลูกค้ายืนรออยู่หน้าเคาน์เตอร์
 */

type Sql = ReturnType<typeof postgres>;

const OPTS = {
  max: 5,
  idle_timeout: 20,
  // ต้องปิดเสมอ ทั้ง Supabase pooler และ Hyperdrive ทำงานแบบ transaction mode
  prepare: false,
} as const;

const WORKER_OPTS = { ...OPTS, max: 1, fetch_types: false } as const;

/**
 * binding ของ Hyperdrive อ่านได้เฉพาะตอนอยู่ในคำขอ
 * ต้องเป็น import ปกติ ห้าม require() เพราะในบันเดิลของ Worker จะใช้ไม่ได้
 * แล้วเงียบ ๆ ตกไปใช้ DATABASE_URL ที่ถูกฝังตอน build ทำให้ต่อไม่ผ่าน Hyperdrive
 */
function cloudflareEnv(): Record<string, unknown> | null {
  try {
    return (getCloudflareContext().env as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

function connectionString(env: Record<string, unknown> | null): string {
  const hd = env?.HYPERDRIVE as { connectionString?: string } | undefined;
  if (hd?.connectionString) return hd.connectionString;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env.local ก่อน");
  return url;
}

let local: Sql | undefined;

/** ใช้เหมือนเดิมทุกที่: sql`SELECT ...` */
export const sql = new Proxy(function () {} as unknown as Sql, {
  apply(_t, _self, args: unknown[]) {
    const env = cloudflareEnv();

    if (env) {
      const client = postgres(connectionString(env), WORKER_OPTS);
      return (client as unknown as (...a: unknown[]) => unknown)(...args);
    }

    if (!local) local = postgres(connectionString(null), OPTS);
    return (local as unknown as (...a: unknown[]) => unknown)(...args);
  },
}) as Sql;

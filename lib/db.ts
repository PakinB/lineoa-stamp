import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * ตัวเชื่อมฐานข้อมูล — ใช้ไดรเวอร์บาง ๆ ไม่ใช้ ORM
 *
 * เหตุผล: ตรรกะแกนกลางอยู่ในฟังก์ชันของ Postgres (db/migrations/0002_functions.sql)
 * เพราะต้องการล็อกแถวและทรานแซกชันที่ควบคุมได้แม่นยำ ORM จะบังหน้าส่วนนั้น
 *
 * ── ทำไมโค้ดส่วนนี้ถึงต่างกันตามที่รัน ──
 *
 * บนเครื่อง: เก็บตัวเชื่อมไว้ใช้ซ้ำได้ตามปกติ
 *
 * บน Cloudflare Workers: **ห้ามใช้ซ้ำข้ามคำขอเด็ดขาด** เพราะ Workers ผูก
 * ทุก I/O ไว้กับคำขอที่สร้างมัน พอคำขอจบ socket นั้นใช้ต่อไม่ได้ และอาการ
 * ที่เกิดคือคำขอถัดไป "ค้างแล้วไม่ตอบอะไรเลย" ไม่ใช่ error ที่อ่านออก
 * (คำขอแรกในแต่ละ isolate จะผ่าน คำขอถัดไปค้างหมด — หลอกมากตอนดีบัก)
 *
 * จึงสร้างตัวเชื่อมใหม่ต่อหนึ่งคำสั่ง แล้วปิดทิ้งเมื่อเสร็จ
 * ไม่แพงอย่างที่คิดเพราะปลายทางคือ Hyperdrive ซึ่งทำ pool ไว้ให้แล้ว
 * และเป็นรูปแบบที่ Cloudflare แนะนำเองสำหรับ Postgres
 */

type Sql = ReturnType<typeof postgres>;

const OPTS = {
  max: 5,
  idle_timeout: 20,
  // ต้องปิดเสมอ ทั้ง Supabase pooler และ Hyperdrive ทำงานแบบ transaction mode
  // ซึ่งใช้ prepared statement ข้ามคำขอไม่ได้
  prepare: false,
} as const;

/**
 * ตัวเลือกเพิ่มสำหรับ Workers
 *
 * fetch_types: false — ปกติ postgres.js จะยิงคำสั่งถามชนิดข้อมูลของ Postgres
 * ตอนเชื่อมต่อครั้งแรก เป็นรอบสื่อสารพิเศษที่บน Workers แล้วค้างไม่จบ
 * จนรันไทม์ตัดสินว่าโค้ดแฮงก์ Cloudflare จึงระบุให้ปิดตัวนี้
 *
 * max: 1 — หนึ่งตัวเชื่อมต่อหนึ่งคำสั่งอยู่แล้ว ไม่ต้องเผื่อ pool ฝั่งนี้
 */
const WORKER_OPTS = { ...OPTS, max: 1, fetch_types: false } as const;

/**
 * binding ของ Hyperdrive อ่านได้เฉพาะตอนอยู่ในคำขอ
 *
 * ต้องเป็น import แบบปกติ ห้ามใช้ require() เพราะในบันเดิลของ Worker
 * require จะใช้ไม่ได้ แล้วเงียบ ๆ ตกไปใช้ DATABASE_URL ที่ถูกฝังตอน build
 * ผลคือ Worker พยายามต่อ Supabase ตรง ๆ ไม่ผ่าน Hyperdrive แล้วค้าง
 * โดยไม่มี error ให้เห็น
 */
function cloudflareEnv(): {
  env: Record<string, unknown> | null;
  ctx: object | undefined;
} {
  try {
    const c = getCloudflareContext();
    return { env: (c.env as Record<string, unknown>) ?? null, ctx: c.ctx };
  } catch {
    return { env: null, ctx: undefined };
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

/**
 * เก็บตัวเชื่อมไว้ต่อหนึ่งคำขอ ไม่ใช่ต่อหนึ่งคำสั่ง
 *
 * ผูกไว้กับอ็อบเจกต์ ctx ของคำขอนั้น ๆ ผ่าน WeakMap ทำให้:
 *   - คำสั่งหลายคำสั่งในคำขอเดียวใช้ตัวเชื่อมร่วมกัน ไม่เปิดใหม่ซ้ำ ๆ
 *   - คำขอคนละครั้งไม่ใช้ตัวเชื่อมร่วมกัน ซึ่ง Workers ห้ามไว้
 *
 * เดิมเปิดใหม่ทุกคำสั่ง ทำให้หนึ่งคำขอกินหลายตัวเชื่อมและติด ๆ ดับ ๆ
 */
const perRequest = new WeakMap<object, Sql>();

function workerClient(ctx: object | undefined, env: Record<string, unknown>): Sql {
  // ถ้าไม่มี ctx ของคำขอนี้ ห้ามใช้ env เป็นกุญแจแทนเด็ดขาด
  // เพราะ env เป็นอ็อบเจกต์เดียวกันทั้ง isolate จะกลายเป็นใช้ตัวเชื่อมซ้ำ
  // ข้ามคำขอ ซึ่ง Workers ห้ามไว้ และทำให้คำขอค้างแบบไม่มีรูปแบบ
  if (!ctx) return postgres(connectionString(env), WORKER_OPTS);

  const found = perRequest.get(ctx);
  if (found) return found;

  const client = postgres(connectionString(env), WORKER_OPTS);
  perRequest.set(ctx, client);
  // ไม่สั่งปิดที่นี่: client.end() เริ่มปิดทันทีที่เรียก ไม่ได้รอให้คำสั่งที่ค้างอยู่จบก่อน
  // ส่งเข้า waitUntil ตรง ๆ จึงกลายเป็นการปิดตัดหน้าคำสั่งของตัวเอง
  // ปล่อยให้ isolate เก็บกวาด — หนึ่งตัวเชื่อมต่อหนึ่งคำขอถือว่าน้อยพอแล้ว
  return client;
}


/** ใช้เหมือนเดิมทุกที่: sql`SELECT ...` */
export const sql = new Proxy(function () {} as unknown as Sql, {
  apply(_t, _self, args: unknown[]) {
    const { env, ctx } = cloudflareEnv();

    if (env) {
      const client = workerClient(ctx, env);
      return (client as unknown as (...a: unknown[]) => unknown)(...args);
    }

    // บนเครื่อง — ใช้ซ้ำได้ตามปกติ
    if (!local) local = postgres(connectionString(null), OPTS);
    return (local as unknown as (...a: unknown[]) => unknown)(...args);
  },
}) as Sql;

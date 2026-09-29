import postgres from "postgres";

/**
 * Worker เล็ก ๆ ที่ทำหน้าที่เดียว — แตะฐานข้อมูลวันละครั้ง
 * กัน Supabase ชั้นฟรีหยุดโปรเจกต์เองเมื่อไม่มีการใช้งาน
 *
 * แยกจาก Worker หลักโดยตั้งใจ เพราะตัวหลักสร้างจาก OpenNext ซึ่งกำหนด
 * ตัว entry เอง การแทรก scheduled handler เข้าไปจะเปราะเวลาอัปเดตเวอร์ชัน
 * ตัวนี้พังก็ไม่กระทบร้าน และแก้ได้โดยไม่ต้อง build แอปใหม่
 */

interface Env {
  HYPERDRIVE: { connectionString: string };
}

type Scheduled = { scheduledTime: number; cron: string };
type Ctx = { waitUntil(p: Promise<unknown>): void };

export default {
  async scheduled(_event: Scheduled, env: Env, ctx: Ctx) {
    ctx.waitUntil(ping(env));
  },

  // เรียกผ่าน URL ได้ด้วย เผื่ออยากทดสอบโดยไม่ต้องรอถึงเวลา
  async fetch(_req: Request, env: Env): Promise<Response> {
    const r = await ping(env);
    return new Response(JSON.stringify(r), {
      status: r.ok ? 200 : 503,
      headers: { "content-type": "application/json" },
    });
  },
};

async function ping(env: Env) {
  const t0 = Date.now();
  try {
    // ตัวเลือกเดียวกับ lib/db.ts — Workers ต้องปิด fetch_types และ prepare
    // และห้ามเรียก end() เพราะจะกลายเป็น I/O ค้างจนรันไทม์ตัดสินว่าแฮงก์
    const sql = postgres(env.HYPERDRIVE.connectionString, {
      max: 1,
      prepare: false,
      fetch_types: false,
    });
    const rows = await sql`SELECT count(*)::int AS n FROM branches`;
    const out = { ok: true, branches: rows[0].n, ms: Date.now() - t0 };
    console.log("keepalive", JSON.stringify(out));
    return out;
  } catch (e) {
    const out = { ok: false, error: (e as Error).message.slice(0, 200), ms: Date.now() - t0 };
    console.error("keepalive failed", JSON.stringify(out));
    return out;
  }
}

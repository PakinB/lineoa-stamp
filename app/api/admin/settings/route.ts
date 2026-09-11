import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/** ดึงการตั้งค่าระบบทั้งหมด */
export async function GET() {
  return handler(async () => {
    await requireStaff("owner");

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_admin_get_settings() AS result`;

    return json(row.result);
  });
}

/** ปรับปรุงค่าตั้งค่าระบบ */
export async function POST(req: Request) {
  return handler(async () => {
    const sess = await requireStaff("owner");

    const body = (await req.json()) as {
      key?: string;
      value?: unknown;
    };

    if (!body.key) return fail("key_required", 400);

    const [row] = await sql<{ result: { ok: boolean; reason?: string } }[]>`
      SELECT api_admin_update_setting(
        ${body.key},
        ${JSON.stringify(body.value)},
        ${sess.sid}
      ) AS result`;

    return json(row.result, row.result.ok ? 200 : 400);
  });
}

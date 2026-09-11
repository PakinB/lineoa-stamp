import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/** ดึงรายการ checkpoints และตัวเลือกรางวัลทั้งหมด */
export async function GET() {
  return handler(async () => {
    await requireStaff("owner");

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_admin_get_rewards() AS result`;

    return json(row.result);
  });
}

/** บันทึกของรางวัลทั้ง 1-10 ช่อง */
export async function PUT(req: Request) {
  return handler(async () => {
    await requireStaff("owner");

    const body = (await req.json()) as {
      slots?: { slot_no: number; label: string }[];
    };

    if (!Array.isArray(body.slots)) return fail("slots_array_required", 400);

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_admin_save_all_rewards(${JSON.stringify(body.slots)}) AS result`;

    return json(row.result);
  });
}

/** เพิ่มตัวเลือกรางวัลใหม่ใน checkpoint */
export async function POST(req: Request) {
  return handler(async () => {
    await requireStaff("owner");

    const body = (await req.json()) as {
      checkpoint_id?: string;
      name?: string;
      sort?: number;
    };

    if (!body.checkpoint_id) return fail("checkpoint_id_required", 400);
    if (!body.name || !body.name.trim()) return fail("name_required", 400);

    const [row] = await sql<{ result: { ok: boolean; reason?: string } }[]>`
      SELECT api_admin_add_reward_option(
        ${body.checkpoint_id},
        ${body.name.trim()},
        ${body.sort ?? 1}
      ) AS result`;

    return json(row.result, row.result.ok ? 200 : 400);
  });
}

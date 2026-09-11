import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { json, handler } from "@/lib/http";

/** เปิด/ปิดตัวเลือกรางวัล (เช่น โค้กหมด -> ปิดชั่วคราว) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireStaff("owner");
    const { id } = await params;

    const body = (await req.json()) as { is_active?: boolean };
    const isActive = body.is_active ?? true;

    const [row] = await sql<{ result: { ok: boolean; reason?: string } }[]>`
      SELECT api_admin_toggle_reward_option(${id}, ${isActive}) AS result`;

    return json(row.result, row.result.ok ? 200 : 400);
  });
}

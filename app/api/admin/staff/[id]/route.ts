import { sql } from "@/lib/db";
import { requireStaff, hashPin } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/** แก้ไขข้อมูลพนักงาน / รีเซ็ต PIN / ปลดล็อก */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireStaff("owner");
    const { id } = await params;

    const body = (await req.json()) as {
      name?: string;
      role?: "staff" | "manager" | "owner";
      branch_id?: string;
      pin?: string;
      unlock?: boolean;
    };

    let pinHash: string | null = null;
    if (body.pin) {
      if (!/^\d{6}$/.test(body.pin)) return fail("invalid_pin_format", 400);
      pinHash = await hashPin(body.pin);
    }

    const [row] = await sql<{ result: { ok: boolean; reason?: string } }[]>`
      SELECT api_admin_update_staff(
        ${id},
        ${body.name ?? null},
        ${body.role ?? null},
        ${body.branch_id ?? null},
        ${pinHash},
        ${body.unlock ?? false}
      ) AS result`;

    return json(row.result, row.result.ok ? 200 : 400);
  });
}

/** เพิกถอนพนักงาน */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await requireStaff("owner");
    const { id } = await params;

    const [row] = await sql<{ result: { ok: boolean; reason?: string } }[]>`
      SELECT api_admin_revoke_staff(${id}) AS result`;

    return json(row.result, row.result.ok ? 200 : 400);
  });
}

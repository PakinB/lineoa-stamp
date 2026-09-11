import { sql } from "@/lib/db";
import { requireStaff, hashPin } from "@/lib/auth/staff";
import { json, fail, handler } from "@/lib/http";

/** ดึงรายชื่อพนักงานและสาขาทั้งหมด */
export async function GET() {
  return handler(async () => {
    await requireStaff("owner");

    const [row] = await sql<{ result: unknown }[]>`
      SELECT api_admin_staff_list() AS result`;

    return json(row.result);
  });
}

/** เพิ่มพนักงานใหม่ */
export async function POST(req: Request) {
  return handler(async () => {
    await requireStaff("owner");

    const body = (await req.json()) as {
      name?: string;
      role?: "staff" | "manager" | "owner";
      branch_id?: string;
      pin?: string;
    };

    if (!body.name || !body.name.trim()) return fail("name_required", 400);
    const pin = body.pin ?? "";
    if (!/^\d{6}$/.test(pin)) return fail("invalid_pin_format", 400);

    const role = body.role ?? "staff";
    if (role !== "owner" && !body.branch_id) {
      return fail("branch_required_for_staff", 400);
    }

    const pinHash = await hashPin(pin);

    const [row] = await sql<{ result: { ok: boolean; reason?: string } }[]>`
      SELECT api_admin_add_staff(
        ${body.name.trim()},
        ${role},
        ${pinHash},
        ${role === "owner" ? null : (body.branch_id ?? null)}
      ) AS result`;

    return json(row.result, row.result.ok ? 200 : 400);
  });
}

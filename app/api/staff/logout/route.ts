import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { json, handler } from "@/lib/http";

export async function POST() {
  return handler(async () => {
    (await cookies()).delete(SESSION_COOKIE);
    return json({ ok: true });
  });
}

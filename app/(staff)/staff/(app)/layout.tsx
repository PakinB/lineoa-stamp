import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

/** ทุกหน้าใต้กลุ่มนี้ต้องเข้ากะแล้ว — ยังไม่เข้าให้เด้งไปหน้า PIN */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  try {
    await readSession(jar.get(SESSION_COOKIE)?.value);
  } catch {
    redirect("/staff/login");
  }
  return <>{children}</>;
}

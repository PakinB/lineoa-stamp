import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * ห้าม cache layout นี้เด็ดขาด — ไม่อย่างนั้น Next.js อาจ prefetch แล้วเสิร์ฟ
 * หน้าจอเก่าที่ไม่ได้ตรวจ session ให้ผู้ใช้ที่ยังไม่ได้ล็อกอิน
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

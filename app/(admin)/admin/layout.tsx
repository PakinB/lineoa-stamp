import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import LogoutButton from "@/components/LogoutButton";
import AdminNav from "./AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  let sess;
  try {
    sess = await readSession(jar.get(SESSION_COOKIE)?.value);
    if (sess.role !== "owner") {
      redirect("/staff/login?next=/admin");
    }
  } catch {
    redirect("/staff/login?next=/admin");
  }

  return (
    <div className="screen" style={{ maxWidth: 640 }}>
      <div className="topbar">
        <div>
          <h1>⚙️ จัดการร้าน (Admin)</h1>
          <div className="who">สิทธิ์เจ้าของร้าน · บัตรสะสม La-Mi</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/staff" className="btn ghost small" style={{ width: "auto", textDecoration: "none" }}>
            หน้าร้าน
          </Link>
          <LogoutButton />
        </div>
      </div>

      <AdminNav />

      <div className="grow">{children}</div>
    </div>
  );
}

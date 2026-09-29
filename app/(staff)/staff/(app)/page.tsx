import Link from "next/link";
import { sql } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import LogoutButton from "@/components/LogoutButton";

/** หน้าหลัก — สองปุ่มใหญ่ที่พนักงานกดทั้งวัน ไม่มีอย่างอื่นมาแย่งความสนใจ */
export default async function Home() {
  const sess = await requireStaff();

  // หนึ่งคำขอ = หนึ่งคำสั่ง SQL (ดู lib/db.ts) จึงดึงชื่อพนักงานกับค่าตั้งค่า
  // มาในคำสั่งเดียว แยกเป็นสองคำสั่งแล้วจะค้างแบบสุ่มบน Cloudflare Workers
  const [me] = await sql<{
    name: string; branch: string | null; promo_points: number;
  }[]>`
    SELECT s.name,
           b.name AS branch,
           COALESCE((SELECT NULLIF(value, 'null'::jsonb)::int
                       FROM app_settings WHERE key = 'promo_points'), 3) AS promo_points
      FROM staff_users s LEFT JOIN branches b ON b.id = s.branch_id
     WHERE s.id = ${sess.sid}`;
  const promoPoints = me?.promo_points ?? 3;

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>{me?.branch ?? "ทุกสาขา"}</h1>
          <div className="who">{me?.name}</div>
        </div>
        <LogoutButton />
      </div>

      <div className="grow stack" style={{ justifyContent: "center", gap: 16 }}>
        <Link href="/staff/stamp" className="btn" style={{ textDecoration: "none" }}>
          ออก QR สะสมแต้ม
        </Link>
        <Link href="/staff/promo" className="btn promo" style={{ textDecoration: "none" }}>
          โปรโมชั่น — ปั๊ม {promoPoints} ดวง
        </Link>
        <Link href="/staff/reward" className="btn ghost" style={{ textDecoration: "none" }}>
          ลูกค้ามารับรางวัล
        </Link>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <Link href="/staff/summary" className="btn ghost small" style={{ textDecoration: "none" }}>
          สรุปกะวันนี้
        </Link>
        {sess.role === "owner" && (
          <Link href="/admin" className="btn ghost small" style={{ textDecoration: "none", color: "var(--brand-d)" }}>
            ⚙️ ระบบจัดการร้าน (Admin)
          </Link>
        )}
      </div>
    </div>
  );
}

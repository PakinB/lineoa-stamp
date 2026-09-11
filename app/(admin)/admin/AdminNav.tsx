"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminNav() {
  const pathname = usePathname();

  const tabs = [
    { href: "/admin", label: "📊 ภาพรวม" },
    { href: "/admin/staff", label: "👥 จัดการพนักงาน" },
    { href: "/admin/rewards", label: "🎁 ของรางวัล" },
    { href: "/admin/settings", label: "⚙️ ตั้งค่าระบบ" },
  ];

  return (
    <nav className="admin-tabs">
      {tabs.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`tab-link${active ? " active" : ""}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

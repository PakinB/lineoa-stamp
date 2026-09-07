"use client";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="btn ghost small"
      style={{ width: "auto" }}
      onClick={async () => {
        await fetch("/api/staff/logout", { method: "POST" });
        router.replace("/staff/login");
      }}
    >
      ออกกะ
    </button>
  );
}

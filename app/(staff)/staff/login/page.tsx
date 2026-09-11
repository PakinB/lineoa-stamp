"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface StaffItem {
  id: string;
  name: string;
  role: "staff" | "manager" | "owner";
  branch_name: string;
  branch_id: string | null;
  is_locked: boolean;
  locked_until: string | null;
}

export default function Login() {
  return (
    <Suspense fallback={<div className="screen"><div className="grow center"><p className="hint">กำลังโหลด…</p></div></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next");

  useEffect(() => {
    async function fetchStaff() {
      try {
        const res = await fetch("/api/staff/login");
        if (res.ok) {
          const d = (await res.json()) as { ok: boolean; staff: StaffItem[] };
          setStaffList(d.staff || []);
        }
      } catch {
        setErr("ไม่สามารถโหลดรายชื่อพนักงานได้ ตรวจสอบการเชื่อมต่อ");
      } finally {
        setLoading(false);
      }
    }
    fetchStaff();
  }, []);

  async function submit(value: string) {
    if (!selectedStaff) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staff_id: selectedStaff.id, pin: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        if (nextUrl) {
          router.replace(nextUrl);
        } else if (data.role === "owner") {
          router.replace("/admin");
        } else {
          router.replace("/staff");
        }
        return;
      }

      setPin("");
      setBusy(false);
      if (data.reason === "outside_working_hours") {
        setErr("เข้ากะได้เฉพาะเวลา 11:00 น. - 22:00 น.");
      } else if (data.reason === "account_locked") {
        setErr("บัญชีถูกระงับชั่วคราวเนื่องจากใส่ PIN ผิดเกินกำหนด กรุณารอ 15 นาที หรือติดต่อเจ้าของร้าน");
      } else if (data.reason === "invalid_pin") {
        setErr("PIN ไม่ถูกต้อง กรุณาลองใหม่");
      } else {
        setErr("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } catch {
      setPin("");
      setBusy(false);
      setErr("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    }
  }

  function press(d: string) {
    if (busy || pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 6) submit(next);
  }

  // ขั้นที่ 1: เลือกชื่อพนักงาน
  if (!selectedStaff) {
    return (
      <div className="screen">
        <div className="topbar">
          <h1>เข้ากะ / เข้าสู่ระบบ</h1>
        </div>

        <div className="grow stack" style={{ marginTop: 8 }}>
          <p className="hint" style={{ textAlign: "left" }}>เลือกชื่อของคุณเพื่อใส่ PIN เข้าสู่ระบบ</p>

          {loading && <p className="hint" style={{ marginTop: 24 }}>กำลังโหลดรายชื่อพนักงาน…</p>}

          {!loading && staffList.length === 0 && (
            <div className="card" style={{ textAlign: "center", marginTop: 16 }}>
              <p className="hint">ยังไม่มีรายชื่อพนักงานในระบบ</p>
            </div>
          )}

          {!loading && staffList.length > 0 && (
            <div className="stack" style={{ gap: 10 }}>
              {staffList.map((s) => (
                <button
                  key={s.id}
                  className="btn ghost"
                  style={{
                    justifyContent: "space-between",
                    padding: "16px 18px",
                    textAlign: "left",
                    opacity: s.is_locked ? 0.6 : 1,
                  }}
                  onClick={() => {
                    if (s.is_locked) {
                      setErr("บัญชีนี้ถูกระงับชั่วคราว กรุณารอ 15 นาที หรือติดต่อเจ้าของร้าน");
                      return;
                    }
                    setSelectedStaff(s);
                    setPin("");
                    setErr("");
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 18 }}>{s.name}</div>
                    <div className="who" style={{ marginTop: 2 }}>
                      {s.role === "owner" ? "เจ้าของร้าน" : s.role === "manager" ? "ผู้จัดการ" : "พนักงาน"} · {s.branch_name}
                    </div>
                  </div>
                  {s.is_locked ? (
                    <span style={{ fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>ระงับชั่วคราว</span>
                  ) : (
                    <span style={{ fontSize: 20, color: "var(--muted)" }}>›</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {err && <p className="err" style={{ marginTop: 16 }}>{err}</p>}
        </div>
      </div>
    );
  }

  // ขั้นที่ 2: หน้าใส่ PIN
  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>{selectedStaff.name}</h1>
          <div className="who">
            {selectedStaff.role === "owner" ? "เจ้าของร้าน" : "พนักงาน"} · {selectedStaff.branch_name}
          </div>
        </div>
        <button
          className="btn ghost small"
          style={{ width: "auto", padding: "8px 12px" }}
          onClick={() => {
            setSelectedStaff(null);
            setPin("");
            setErr("");
          }}
          disabled={busy}
        >
          เปลี่ยนคน
        </button>
      </div>

      <div className="grow center">
        <p className="hint">
          {selectedStaff.role === "staff"
            ? "ใส่ PIN 6 หลักของคุณ (เวลาทำการ 11:00 - 22:00 น.)"
            : "ใส่ PIN 6 หลักของคุณ"}
        </p>

        <div className="pin-dots" aria-label={`ใส่แล้ว ${pin.length} จาก 6 หลัก`}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} className={i < pin.length ? "on" : ""} />
          ))}
        </div>

        <p className="err" style={{ maxWidth: 360 }}>{err}</p>
      </div>

      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <button className="blank" aria-hidden tabIndex={-1} />
        <button onClick={() => press("0")} disabled={busy}>0</button>
        <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="ลบ" disabled={busy}>
          ⌫
        </button>
      </div>
    </div>
  );
}

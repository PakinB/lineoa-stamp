"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * เข้ากะด้วย PIN 6 หลัก
 *
 * ใช้แป้นตัวเลขบนหน้าจอแทน <input> เพราะคีย์บอร์ดของระบบจะเด้งขึ้นมาบังจอ
 * และปุ่มเล็กเกินกว่าจะกดได้ถนัดตอนมือเปียก (§4)
 */
export default function Login() {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(value: string) {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/staff/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: value }),
    });
    if (res.ok) {
      router.replace("/staff");
      return;
    }
    setPin("");
    setErr("PIN ไม่ถูกต้อง");
    setBusy(false);
  }

  function press(d: string) {
    if (busy || pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 6) submit(next);
  }

  return (
    <div className="screen">
      <div className="topbar">
        <h1>เข้ากะ</h1>
      </div>

      <div className="grow center">
        <p className="hint">ใส่ PIN 6 หลักของคุณ</p>

        <div className="pin-dots" aria-label={`ใส่แล้ว ${pin.length} จาก 6 หลัก`}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} className={i < pin.length ? "on" : ""} />
          ))}
        </div>

        <p className="err">{err}</p>
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

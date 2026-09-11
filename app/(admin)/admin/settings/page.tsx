"use client";

import { useEffect, useState } from "react";

interface SettingItem {
  value: unknown;
  description: string;
  updated_at: string;
}

export default function SettingsManagement() {
  const [settings, setSettings] = useState<Record<string, SettingItem>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Form states for key settings
  const [shiftStart, setShiftStart] = useState("11");
  const [shiftEnd, setShiftEnd] = useState("22");
  const [pinMax, setPinMax] = useState("5");
  const [pinLockout, setPinLockout] = useState("15");
  const [tokenTtl, setTokenTtl] = useState("10");
  const [redeemTtl, setRedeemTtl] = useState("5");
  const [undoMinutes, setUndoMinutes] = useState("10");

  async function loadData() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/settings");
      if (res.ok) {
        const d = (await res.json()) as { ok: boolean; settings: Record<string, SettingItem> };
        const s = d.settings || {};
        setSettings(s);

        if (s.shift_start_hour) setShiftStart(String(s.shift_start_hour.value));
        if (s.shift_end_hour) setShiftEnd(String(s.shift_end_hour.value));
        if (s.pin_max_attempts) setPinMax(String(s.pin_max_attempts.value));
        if (s.pin_lockout_minutes) setPinLockout(String(s.pin_lockout_minutes.value));
        if (s.token_ttl_minutes) setTokenTtl(String(s.token_ttl_minutes.value));
        if (s.redeem_token_ttl_minutes) setRedeemTtl(String(s.redeem_token_ttl_minutes.value));
        if (s.redemption_undo_minutes) setUndoMinutes(String(s.redemption_undo_minutes.value));
      }
    } catch {
      setErr("โหลดการตั้งค่าระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function saveSetting(key: string, value: any, label: string) {
    setSavingKey(key);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        setMsg(`บันทึก ${label} เรียบร้อยแล้ว`);
        loadData();
      } else {
        setErr(`บันทึก ${label} ไม่สำเร็จ`);
      }
    } catch {
      setErr("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveWorkingHours(e: React.FormEvent) {
    e.preventDefault();
    await saveSetting("shift_start_hour", parseInt(shiftStart, 10), "เวลาเริ่มเข้ากะ");
    await saveSetting("shift_end_hour", parseInt(shiftEnd, 10), "เวลาสิ้นสุดเข้ากะ");
  }

  async function savePinSecurity(e: React.FormEvent) {
    e.preventDefault();
    await saveSetting("pin_max_attempts", parseInt(pinMax, 10), "จำนวนครั้งที่เดา PIN ผิด");
    await saveSetting("pin_lockout_minutes", parseInt(pinLockout, 10), "ระยะเวลาล็อกบัญชี");
  }

  async function saveTtls(e: React.FormEvent) {
    e.preventDefault();
    await saveSetting("token_ttl_minutes", parseInt(tokenTtl, 10), "อายุ QR สะสม");
    await saveSetting("redeem_token_ttl_minutes", parseInt(redeemTtl, 10), "อายุ QR รางวัล");
    await saveSetting("redemption_undo_minutes", parseInt(undoMinutes, 10), "เวลาคืนสิทธิ์");
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: 0 }}>ตั้งค่าระบบ</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          ปรับแต่งกติกาและค่าความปลอดภัย ค่าทั้งหมดถูกอ่านจากตาราง app_settings แบบเรียลไทม์
        </span>
      </div>

      {msg && <div className="card" style={{ background: "var(--ok-bg)", borderColor: "#CDE3CB", padding: "12px 16px", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>{msg}</div>}
      {err && <p className="err">{err}</p>}

      {loading ? (
        <p className="hint">กำลังโหลดการตั้งค่า…</p>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {/* เวลาทำการเข้ากะของพนักงาน */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>⏰ เวลาเข้ากะของพนักงาน</h3>
            <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>
              พนักงานทั่วไป (Staff) จะสามารถใส่ PIN เข้าสู่ระบบได้เฉพาะช่วงเวลานี้เท่านั้น (เจ้าของร้านเข้าได้ตลอดเวลา)
            </p>

            <form onSubmit={saveWorkingHours} className="stack" style={{ gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label>เวลาเริ่ม (น.)</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    className="input-text"
                    value={shiftStart}
                    onChange={(e) => setShiftStart(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>เวลาสิ้นสุด (น.)</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    className="input-text"
                    value={shiftEnd}
                    onChange={(e) => setShiftEnd(e.target.value)}
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn small"
                style={{ width: "auto", alignSelf: "flex-end" }}
                disabled={savingKey !== null}
              >
                บันทึกเวลาเข้ากะ
              </button>
            </form>
          </div>

          {/* ความปลอดภัยของ PIN */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>🔒 ความปลอดภัย PIN (ป้องกันการเดารหัส)</h3>
            <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>
              ระงับบัญชีชั่วคราวเมื่อมีการใส่ PIN ผิดติดต่อกันเกินจำนวนที่กำหนด
            </p>

            <form onSubmit={savePinSecurity} className="stack" style={{ gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label>เดาผิดได้สูงสุด (ครั้ง)</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    className="input-text"
                    value={pinMax}
                    onChange={(e) => setPinMax(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>ระยะเวลาล็อกบัญชี (นาที)</label>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    className="input-text"
                    value={pinLockout}
                    onChange={(e) => setPinLockout(e.target.value)}
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn small"
                style={{ width: "auto", alignSelf: "flex-end" }}
                disabled={savingKey !== null}
              >
                บันทึกความปลอดภัย PIN
              </button>
            </form>
          </div>

          {/* อายุ QR และการทำงานหน้าร้าน */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>⏱️ อายุของ QR Code และการคืนสิทธิ์</h3>
            <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>
              ระยะเวลาหมดอายุของ QR ที่ออกบนจอพนักงานเพื่อป้องกันการส่งต่อ
            </p>

            <form onSubmit={saveTtls} className="stack" style={{ gap: 12 }}>
              <div className="form-group">
                <label>อายุ QR สะสมแต้ม (นาที)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  className="input-text"
                  value={tokenTtl}
                  onChange={(e) => setTokenTtl(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>อายุ QR รับของรางวัล (นาที)</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  className="input-text"
                  value={redeemTtl}
                  onChange={(e) => setRedeemTtl(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>ระยะเวลาที่พนักงานกดยกเลิกคืนสิทธิ์ได้ (นาที)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  className="input-text"
                  value={undoMinutes}
                  onChange={(e) => setUndoMinutes(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn small"
                style={{ width: "auto", alignSelf: "flex-end" }}
                disabled={savingKey !== null}
              >
                บันทึกอายุ QR
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

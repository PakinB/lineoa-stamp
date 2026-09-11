"use client";

import { useEffect, useState } from "react";

interface SlotReward {
  slot_no: number;
  label: string;
  is_active: boolean;
  checkpoint_id: string | null;
}

export default function RewardsManagement() {
  const [slots, setSlots] = useState<SlotReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function loadData() {
    try {
      setLoading(true);
      setErr("");
      const res = await fetch("/api/admin/rewards");
      if (res.ok) {
        const d = (await res.json()) as { ok: boolean; slots: SlotReward[] };
        setSlots(d.slots || []);
      } else {
        setErr("โหลดข้อมูลของรางวัลไม่สำเร็จ");
      }
    } catch {
      setErr("โหลดข้อมูลของรางวัลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function handleLabelChange(slot_no: number, newLabel: string) {
    setSlots((prev) =>
      prev.map((s) =>
        s.slot_no === slot_no ? { ...s, label: newLabel, is_active: newLabel.trim().length > 0 } : s
      )
    );
  }

  function handleClearSlot(slot_no: number) {
    handleLabelChange(slot_no, "");
  }

  async function handleSaveAll(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    setErr("");

    try {
      const res = await fetch("/api/admin/rewards", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slots: slots.map((s) => ({
            slot_no: s.slot_no,
            label: s.label.trim(),
          })),
        }),
      });

      if (res.ok) {
        const d = (await res.json()) as { ok: boolean; slots: SlotReward[] };
        setSlots(d.slots || []);
        setMsg("✓ บันทึกข้อความของรางวัลทั้ง 10 ช่องเรียบร้อยแล้ว");
      } else {
        setErr("บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } catch {
      setErr("บันทึกไม่สำเร็จ เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>🎁 กำหนดของรางวัล (ช่องที่ 1 - 10)</h2>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            ระบุข้อความของรางวัลสำหรับแต่ละช่องสะสม หากช่องไหนไม่มีรางวัลให้เว้นว่างไว้
          </span>
        </div>

        <button
          type="button"
          onClick={handleSaveAll}
          className="btn"
          disabled={loading || saving}
          style={{ width: "auto", padding: "10px 20px" }}
        >
          {saving ? "กำลังบันทึก…" : "💾 บันทึกทั้งหมด"}
        </button>
      </div>

      {msg && (
        <div className="card" style={{ background: "var(--ok-bg)", borderColor: "#CDE3CB", padding: "12px 16px", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>
          {msg}
        </div>
      )}
      {err && <p className="err">{err}</p>}

      {loading ? (
        <p className="hint">กำลังโหลดรายการของรางวัล…</p>
      ) : (
        <form onSubmit={handleSaveAll} className="stack" style={{ gap: 10 }}>
          {slots.map((s) => {
            const hasReward = s.label.trim().length > 0;
            return (
              <div
                key={s.slot_no}
                className="card"
                style={{
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderColor: hasReward ? "var(--brand)" : "var(--line)",
                  background: hasReward ? "#FDFDFD" : "#FAFAFA",
                }}
              >
                <div
                  style={{
                    minWidth: 76,
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: hasReward ? "var(--brand)" : "#E2E8F0",
                    color: hasReward ? "#FFFFFF" : "#64748B",
                    fontWeight: 700,
                    fontSize: 13,
                    textAlign: "center",
                    flexShrink: 0,
                  }}
                >
                  ช่อง {s.slot_no}
                </div>

                <div style={{ flex: 1, position: "relative" }}>
                  <input
                    type="text"
                    className="input-text"
                    style={{
                      paddingRight: hasReward ? 36 : 12,
                      fontWeight: hasReward ? 600 : 400,
                      color: hasReward ? "var(--ink)" : "var(--muted)",
                    }}
                    placeholder={`ไม่มีรางวัลในช่องที่ ${s.slot_no} (เว้นว่างไว้)`}
                    value={s.label}
                    onChange={(e) => handleLabelChange(s.slot_no, e.target.value)}
                  />
                  {hasReward && (
                    <button
                      type="button"
                      onClick={() => handleClearSlot(s.slot_no)}
                      style={{
                        position: "absolute",
                        right: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: 14,
                        padding: 4,
                      }}
                      title="ล้างข้อความ"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div style={{ fontSize: 13, color: hasReward ? "var(--brand)" : "var(--muted)", minWidth: 70, textAlign: "right", flexShrink: 0 }}>
                  {hasReward ? "🎁 มีรางวัล" : "⚪ ว่าง"}
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 8 }}>
            <button
              type="submit"
              className="btn"
              disabled={loading || saving}
              style={{ width: "100%", padding: "14px" }}
            >
              {saving ? "กำลังบันทึก…" : "💾 บันทึกของรางวัลทั้งหมด (1-10)"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

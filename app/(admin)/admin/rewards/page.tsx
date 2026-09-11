"use client";

import { useEffect, useState } from "react";

interface RewardOption {
  id: string;
  name: string;
  sort: number;
  is_active: boolean;
  used_count: number;
}

interface CheckpointItem {
  id: string;
  slot_no: number;
  label: string;
  is_active: boolean;
  options: RewardOption[];
}

export default function RewardsManagement() {
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Modal State for adding new option
  const [addingCheckpoint, setAddingCheckpoint] = useState<CheckpointItem | null>(null);
  const [newOptionName, setNewOptionName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/rewards");
      if (res.ok) {
        const d = (await res.json()) as { ok: boolean; checkpoints: CheckpointItem[] };
        setCheckpoints(d.checkpoints || []);
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

  async function toggleOption(option: RewardOption) {
    const nextState = !option.is_active;
    try {
      const res = await fetch(`/api/admin/rewards/${option.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: nextState }),
      });
      if (res.ok) {
        setMsg(nextState ? `เปิด "${option.name}" เรียบร้อยแล้ว` : `ปิด "${option.name}" (ของหมดชั่วคราว)`);
        loadData();
      }
    } catch {
      setErr("ปรับปรุงสถานะของรางวัลไม่สำเร็จ");
    }
  }

  async function handleAddOption(e: React.FormEvent) {
    e.preventDefault();
    if (!addingCheckpoint || !newOptionName.trim()) return;

    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/rewards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkpoint_id: addingCheckpoint.id,
          name: newOptionName.trim(),
        }),
      });
      if (res.ok) {
        setMsg(`เพิ่มตัวเลือก "${newOptionName}" ในช่องที่ ${addingCheckpoint.slot_no} สำเร็จ`);
        setAddingCheckpoint(null);
        setNewOptionName("");
        loadData();
      }
    } catch {
      setErr("เพิ่มตัวเลือกรางวัลไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: 0 }}>ของรางวัล & Checkpoints</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          ควบคุมรายการของรางวัล เมื่อของหมดสามารถปิดชั่วคราวได้ทันที ลูกค้าจะไม่เห็นตัวเลือกนั้น
        </span>
      </div>

      {msg && <div className="card" style={{ background: "var(--ok-bg)", borderColor: "#CDE3CB", padding: "12px 16px", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>{msg}</div>}
      {err && <p className="err">{err}</p>}

      {loading ? (
        <p className="hint">กำลังโหลดรายการของรางวัล…</p>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {checkpoints.map((c) => (
            <div key={c.id} className="card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, background: "var(--ground)", padding: "2px 8px", borderRadius: 6 }}>
                      ช่องที่ {c.slot_no}
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 700 }}>{c.label}</span>
                  </div>
                </div>
                <button
                  className="btn ghost small"
                  style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                  onClick={() => {
                    setAddingCheckpoint(c);
                    setNewOptionName("");
                  }}
                >
                  ➕ เพิ่มตัวเลือก
                </button>
              </div>

              {c.options.length === 0 ? (
                <p className="hint" style={{ textAlign: "left" }}>ยังไม่มีตัวเลือกของรางวัลในจุดนี้</p>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {c.options.map((opt) => (
                    <div
                      key={opt.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 12px",
                        background: opt.is_active ? "#FAFAFA" : "#FFF5F5",
                        borderRadius: 10,
                        border: opt.is_active ? "1px solid var(--line)" : "1px solid #FFD0D0",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: opt.is_active ? "var(--ink)" : "var(--muted)" }}>
                          {opt.name}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          มอบให้ลูกค้าไปแล้ว {opt.used_count} ครั้ง
                        </div>
                      </div>

                      <button
                        className="btn small"
                        style={{
                          width: "auto",
                          padding: "6px 14px",
                          fontSize: 13,
                          background: opt.is_active ? "var(--ok)" : "var(--stamp)",
                          borderRadius: 8,
                        }}
                        onClick={() => toggleOption(opt)}
                      >
                        {opt.is_active ? "✓ มีของ (เปิด)" : "⛔ ของหมด (ปิด)"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal เพิ่มตัวเลือกของรางวัล */}
      {addingCheckpoint && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>
              ➕ เพิ่มตัวเลือกรางวัล (ช่องที่ {addingCheckpoint.slot_no})
            </h3>
            <form onSubmit={handleAddOption} className="stack" style={{ gap: 14 }}>
              <div className="form-group">
                <label>ชื่อของรางวัล *</label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="เช่น สไปรท์ฟรี 1 กระป๋อง"
                  value={newOptionName}
                  onChange={(e) => setNewOptionName(e.target.value)}
                  required
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  ตัวเลือกนี้จะแสดงให้ลูกค้าเลือกได้เมื่อสแกนรับรางวัลที่ช่องนี้
                </span>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setAddingCheckpoint(null)}
                  disabled={submitting}
                >
                  ยกเลิก
                </button>
                <button type="submit" className="btn small" disabled={submitting}>
                  {submitting ? "กำลังบันทึก…" : "เพิ่มตัวเลือก"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

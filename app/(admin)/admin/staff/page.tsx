"use client";

import { useEffect, useState } from "react";

interface StaffItem {
  id: string;
  name: string;
  role: "staff" | "manager" | "owner";
  branch_id: string | null;
  branch_name: string;
  failed_attempts: number;
  is_locked: boolean;
  locked_until: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface BranchItem {
  id: string;
  code: string;
  name: string;
}

export default function StaffManagement() {
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffItem | null>(null);

  // Form State
  const [formName, setFormName] = useState("");
  const [formRole, setFormRole] = useState<"staff" | "manager" | "owner">("staff");
  const [formBranch, setFormBranch] = useState("");
  const [formPin, setFormPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/staff");
      if (res.ok) {
        const d = (await res.json()) as { ok: boolean; staff: StaffItem[]; branches: BranchItem[] };
        setStaffList(d.staff || []);
        setBranches(d.branches || []);
        if (d.branches?.length > 0 && !formBranch) {
          setFormBranch(d.branches[0].id);
        }
      }
    } catch {
      setErr("โหลดข้อมูลพนักงานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function generateRandomPin() {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    setFormPin(pin);
  }

  function openAddModal() {
    setFormName("");
    setFormRole("staff");
    setFormBranch(branches[0]?.id || "");
    generateRandomPin();
    setErr("");
    setMsg("");
    setShowAddModal(true);
  }

  function openChangePinModal(s: StaffItem) {
    setEditingStaff(s);
    setFormPin("");
    generateRandomPin();
    setErr("");
    setMsg("");
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) { setErr("กรุณากรอกชื่อพนักงาน"); return; }
    if (!/^\d{6}$/.test(formPin)) { setErr("PIN ต้องเป็นตัวเลข 6 หลัก"); return; }

    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          role: formRole,
          branch_id: formRole === "owner" ? null : formBranch,
          pin: formPin,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setShowAddModal(false);
        setMsg(`เพิ่มพนักงาน ${formName} เรียบร้อยแล้ว (PIN: ${formPin})`);
        loadData();
      } else {
        setErr(d.reason === "invalid_pin_format" ? "PIN ต้องเป็นตัวเลข 6 หลัก" : "เพิ่มพนักงานไม่สำเร็จ");
      }
    } catch {
      setErr("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangePin(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStaff) return;
    if (!/^\d{6}$/.test(formPin)) { setErr("PIN ต้องเป็นตัวเลข 6 หลัก"); return; }

    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch(`/api/admin/staff/${editingStaff.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: formPin }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setMsg(`เปลี่ยน PIN สำหรับ ${editingStaff.name} เป็น ${formPin} สำเร็จ`);
        setEditingStaff(null);
        loadData();
      } else {
        setErr("เปลี่ยน PIN ไม่สำเร็จ");
      }
    } catch {
      setErr("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlock(s: StaffItem) {
    if (!confirm(`ต้องการปลดล็อกบัญชีของ "${s.name}" ใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/admin/staff/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unlock: true }),
      });
      if (res.ok) {
        setMsg(`ปลดล็อกบัญชี ${s.name} เรียบร้อยแล้ว`);
        loadData();
      }
    } catch {
      setErr("ปลดล็อกไม่สำเร็จ");
    }
  }

  async function handleRevoke(s: StaffItem) {
    if (!confirm(`คุณแน่ใจว่าต้องการเพิกถอนสิทธิ์ของ "${s.name}" หรือไม่? พนักงานจะไม่สามารถเข้าสู่ระบบได้อีก`)) return;
    try {
      const res = await fetch(`/api/admin/staff/${s.id}`, { method: "DELETE" });
      if (res.ok) {
        setMsg(`เพิกถอนสิทธิ์ ${s.name} แล้ว`);
        loadData();
      }
    } catch {
      setErr("เพิกถอนสิทธิ์ไม่สำเร็จ");
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>พนักงานทั้งหมด</h2>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>เพิ่ม จัดการ PIN และสิทธิ์เข้าใช้งาน</span>
        </div>
        <button className="btn small" style={{ width: "auto" }} onClick={openAddModal}>
          ➕ เพิ่มพนักงาน
        </button>
      </div>

      {msg && <div className="card" style={{ background: "var(--ok-bg)", borderColor: "#CDE3CB", padding: "12px 16px", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>{msg}</div>}
      {err && <p className="err">{err}</p>}

      {loading ? (
        <p className="hint">กำลังโหลดรายชื่อพนักงาน…</p>
      ) : staffList.length === 0 ? (
        <div className="card"><p className="hint">ยังไม่มีรายชื่อพนักงาน</p></div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {staffList.map((s) => {
            const isRevoked = !!s.revoked_at;
            return (
              <div
                key={s.id}
                className="card"
                style={{
                  padding: "16px 18px",
                  opacity: isRevoked ? 0.55 : 1,
                  borderLeft: isRevoked ? "4px solid var(--muted)" : s.is_locked ? "4px solid var(--stamp)" : "4px solid var(--brand)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 17, fontWeight: 700 }}>{s.name}</span>
                      <span className={`badge ${s.role === "owner" ? "warn" : "ok"}`}>
                        {s.role === "owner" ? "เจ้าของร้าน" : s.role === "manager" ? "ผู้จัดการ" : "พนักงาน"}
                      </span>
                      {s.is_locked && <span className="badge err">ถูกระงับชั่วคราว</span>}
                      {isRevoked && <span className="badge" style={{ background: "#eee", color: "#666" }}>เพิกถอนแล้ว</span>}
                    </div>

                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                      สาขา: <b>{s.branch_name}</b>
                      {s.failed_attempts > 0 && !isRevoked && (
                        <span style={{ marginLeft: 10, color: s.is_locked ? "var(--stamp)" : "var(--warn)" }}>
                          (เดาผิด {s.failed_attempts} ครั้ง)
                        </span>
                      )}
                    </div>
                  </div>

                  {!isRevoked && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {s.is_locked && (
                        <button
                          className="btn ghost small"
                          style={{ padding: "6px 10px", fontSize: 13, color: "var(--ok)", borderColor: "var(--ok)" }}
                          onClick={() => handleUnlock(s)}
                        >
                          ปลดล็อก
                        </button>
                      )}
                      <button
                        className="btn ghost small"
                        style={{ padding: "6px 10px", fontSize: 13 }}
                        onClick={() => openChangePinModal(s)}
                      >
                        เปลี่ยน PIN
                      </button>
                      {s.role !== "owner" && (
                        <button
                          className="btn ghost small"
                          style={{ padding: "6px 10px", fontSize: 13, color: "var(--stamp)" }}
                          onClick={() => handleRevoke(s)}
                        >
                          เพิกถอน
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal เพิ่มพนักงานใหม่ */}
      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>➕ เพิ่มพนักงานใหม่</h3>
            <form onSubmit={handleAddStaff} className="stack" style={{ gap: 14 }}>
              <div className="form-group">
                <label>ชื่อพนักงาน *</label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="เช่น สมชาย ลาดพร้าว"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>บทบาท (Role)</label>
                <select
                  className="select-box"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as any)}
                >
                  <option value="staff">พนักงาน (Staff - เข้ากะได้ 11:00-22:00)</option>
                  <option value="manager">ผู้จัดการ (Manager)</option>
                  <option value="owner">เจ้าของร้าน (Owner - เข้าได้ทุกสาขา & จัดการระบบ)</option>
                </select>
              </div>

              {formRole !== "owner" && (
                <div className="form-group">
                  <label>สาขาประจำ *</label>
                  <select
                    className="select-box"
                    value={formBranch}
                    onChange={(e) => setFormBranch(e.target.value)}
                    required
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label>PIN 6 หลัก *</label>
                  <button
                    type="button"
                    className="btn ghost small"
                    style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                    onClick={generateRandomPin}
                  >
                    🎲 สุ่มเลขใหม่
                  </button>
                </div>
                <input
                  type="text"
                  className="input-text"
                  placeholder="ตัวเลข 6 หลัก"
                  maxLength={6}
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value.replace(/\D/g, ""))}
                  style={{ letterSpacing: 4, fontWeight: 700, fontSize: 20, textAlign: "center" }}
                  required
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  จด PIN นี้มอบให้พนักงานใช้เข้ากะ
                </span>
              </div>

              {err && <p className="err" style={{ margin: 0 }}>{err}</p>}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setShowAddModal(false)}
                  disabled={submitting}
                >
                  ยกเลิก
                </button>
                <button type="submit" className="btn small" disabled={submitting}>
                  {submitting ? "กำลังบันทึก…" : "บันทึกพนักงาน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal เปลี่ยน PIN */}
      {editingStaff && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>🔑 เปลี่ยน PIN: {editingStaff.name}</h3>
            <form onSubmit={handleChangePin} className="stack" style={{ gap: 14 }}>
              <div className="form-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label>PIN 6 หลักใหม่ *</label>
                  <button
                    type="button"
                    className="btn ghost small"
                    style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                    onClick={generateRandomPin}
                  >
                    🎲 สุ่มเลขใหม่
                  </button>
                </div>
                <input
                  type="text"
                  className="input-text"
                  placeholder="ตัวเลข 6 หลัก"
                  maxLength={6}
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value.replace(/\D/g, ""))}
                  style={{ letterSpacing: 4, fontWeight: 700, fontSize: 20, textAlign: "center" }}
                  required
                />
              </div>

              {err && <p className="err" style={{ margin: 0 }}>{err}</p>}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setEditingStaff(null)}
                  disabled={submitting}
                >
                  ยกเลิก
                </button>
                <button type="submit" className="btn small" disabled={submitting}>
                  {submitting ? "กำลังเปลี่ยน…" : "เปลี่ยน PIN"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

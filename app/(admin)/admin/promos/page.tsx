"use client";

import { useEffect, useState } from "react";

/**
 * จัดการโปรโมชั่น — เจ้าของสร้างเอง กำหนดดวง และเลือกว่าร่วมได้กี่ครั้ง
 *
 * ไม่มีปุ่มลบโดยตั้งใจ · โปรฯ ที่เคยออก QR ไปแล้วมีประวัติผูกอยู่
 * ลบทิ้งแล้วรายงานย้อนหลังจะอ่านไม่ออกว่าดวงพวกนั้นมาจากไหน ใช้ "ปิด" แทน
 */
interface Promo {
  id: string;
  name: string;
  points: number;
  once_per_customer: boolean;
  is_active: boolean;
  note: string | null;
  created_at: string;
  issued: number;
  claimed: number;
  customers: number;
  stamps: number;
}

const REASONS: Record<string, string> = {
  name_required: "ต้องตั้งชื่อโปรโมชั่นก่อน",
  name_taken: "มีโปรโมชั่นที่เปิดอยู่ชื่อนี้แล้ว ตั้งชื่อให้ต่างกันเพื่อไม่ให้พนักงานกดผิด",
  promo_not_found: "ไม่พบโปรโมชั่นนี้แล้ว",
};

export default function PromosManagement() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [name, setName] = useState("");
  const [points, setPoints] = useState("3");
  const [once, setOnce] = useState(true);

  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPoints, setEditPoints] = useState("3");
  const [editOnce, setEditOnce] = useState(true);

  async function loadData() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/promos");
      if (!res.ok) { setErr("โหลดรายการโปรโมชั่นไม่สำเร็จ"); return; }
      const d = (await res.json()) as { ok: boolean; campaigns: Promo[] };
      setPromos(d.campaigns || []);
    } catch {
      setErr("โหลดรายการโปรโมชั่นไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function send(url: string, method: string, body: unknown, okMsg: string, key: string) {
    setBusy(key);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as { ok: boolean; reason?: string };
      if (res.ok && d.ok) {
        setMsg(okMsg);
        await loadData();
        return true;
      }
      setErr(REASONS[d.reason ?? ""] ?? "บันทึกไม่สำเร็จ");
      return false;
    } catch {
      setErr("เกิดข้อผิดพลาดในการเชื่อมต่อ");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const ok = await send("/api/admin/promos", "POST", {
      name: name.trim(), points: parseInt(points, 10), once_per_customer: once,
    }, `สร้างโปรโมชั่น "${name.trim()}" แล้ว`, "create");
    if (ok) { setName(""); setPoints("3"); setOnce(true); }
  }

  function startEdit(p: Promo) {
    setEditing(p.id);
    setEditName(p.name);
    setEditPoints(String(p.points));
    setEditOnce(p.once_per_customer);
    setErr("");
    setMsg("");
  }

  async function saveEdit(id: string) {
    const ok = await send(`/api/admin/promos/${id}`, "PATCH", {
      name: editName.trim(), points: parseInt(editPoints, 10), once_per_customer: editOnce,
    }, "บันทึกการแก้ไขแล้ว", id);
    if (ok) setEditing(null);
  }

  async function toggleActive(p: Promo) {
    if (p.is_active && !confirm(
      `ปิดโปรโมชั่น "${p.name}" ใช่ไหม\n\n` +
      `พนักงานจะไม่เห็นปุ่มนี้อีก และออก QR จากโปรฯ นี้ไม่ได้\n` +
      `ประวัติ ${p.claimed} ครั้งที่แจกไปแล้วยังอยู่ครบ · เปิดกลับได้ทุกเมื่อ`,
    )) return;

    await send(`/api/admin/promos/${p.id}`, "PATCH", { is_active: !p.is_active },
      p.is_active ? `ปิดโปรโมชั่น "${p.name}" แล้ว` : `เปิดโปรโมชั่น "${p.name}" แล้ว`, p.id);
  }

  const active = promos.filter((p) => p.is_active);
  const closed = promos.filter((p) => !p.is_active);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: 0 }}>โปรโมชั่น</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          พนักงานจะเห็นเฉพาะโปรโมชั่นที่เปิดอยู่ บนหน้าออก QR โปรโมชั่น
        </span>
      </div>

      {msg && (
        <div className="card" style={{ background: "var(--ok-bg)", borderColor: "#CDE3CB", padding: "12px 16px", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>
          {msg}
        </div>
      )}
      {err && <p className="err">{err}</p>}

      {/* สร้างใหม่ */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 16, margin: "0 0 4px" }}>➕ สร้างโปรโมชั่นใหม่</h3>
        <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>
          ตั้งชื่อให้พนักงานอ่านแล้วรู้ทันทีว่าต้องกดตอนไหน เช่น “ลูกค้าใหม่ครั้งแรก” หรือ “มากับเพื่อน 4 คน”
        </p>

        <form onSubmit={create} className="stack" style={{ gap: 12 }}>
          <div className="form-group">
            <label>ชื่อโปรโมชั่น</label>
            <input
              type="text"
              className="input-text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น ลูกค้าใหม่ครั้งแรก"
              maxLength={60}
              required
            />
          </div>

          <div className="form-group">
            <label>ออกโปรฯ นี้แล้วได้กี่ดวง</label>
            <input
              type="number"
              min="1"
              max="10"
              className="input-text"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              required
            />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              ลูกค้าสแกน QR ใบเดียวแล้วได้ครบตามนี้เลย · สูงสุด 10 ดวง (เท่ากับหนึ่งบัตรเต็ม)
            </span>
          </div>

          <div className="form-group">
            <label>ลูกค้าหนึ่งคนร่วมได้กี่ครั้ง</label>
            <div style={{ display: "grid", gap: 8 }}>
              <OnceChoice value={true} picked={once} onPick={setOnce}
                title="ครั้งเดียวเท่านั้น"
                desc="คนที่เคยรับแล้วสแกนไม่ได้อีก · ใช้กับโปรฯ แบบลูกค้าใหม่ หรือของแจกครั้งเดียว" />
              <OnceChoice value={false} picked={once} onPick={setOnce}
                title="ร่วมซ้ำได้ไม่จำกัด"
                desc="มาเมื่อไหร่ก็รับได้อีก ตราบใดที่พนักงานกดออก QR ให้ · ใช้กับโปรฯ ประจำ เช่น มาเป็นกลุ่ม" />
            </div>
          </div>

          <button type="submit" className="btn small" style={{ width: "auto", alignSelf: "flex-end" }}
                  disabled={busy !== null}>
            {busy === "create" ? "กำลังสร้าง…" : "สร้างโปรโมชั่น"}
          </button>
        </form>
      </div>

      {loading ? (
        <p className="hint">กำลังโหลดรายการโปรโมชั่น…</p>
      ) : (
        <>
          <PromoList
            title={`เปิดอยู่ (${active.length})`}
            empty="ยังไม่มีโปรโมชั่นที่เปิดอยู่ — พนักงานจะยังกดปุ่มโปรโมชั่นไม่ได้"
            promos={active} busy={busy} editing={editing}
            editName={editName} editPoints={editPoints} editOnce={editOnce}
            setEditName={setEditName} setEditPoints={setEditPoints} setEditOnce={setEditOnce}
            onEdit={startEdit} onSave={saveEdit} onCancel={() => setEditing(null)} onToggle={toggleActive}
          />
          {closed.length > 0 && (
            <PromoList
              title={`ปิดแล้ว (${closed.length})`}
              empty="" promos={closed} busy={busy} editing={editing}
              editName={editName} editPoints={editPoints} editOnce={editOnce}
              setEditName={setEditName} setEditPoints={setEditPoints} setEditOnce={setEditOnce}
              onEdit={startEdit} onSave={saveEdit} onCancel={() => setEditing(null)} onToggle={toggleActive}
            />
          )}
        </>
      )}
    </div>
  );
}

function OnceChoice({
  value, picked, onPick, title, desc,
}: {
  value: boolean; picked: boolean; onPick: (v: boolean) => void; title: string; desc: string;
}) {
  const on = picked === value;
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 10,
        border: `2px solid ${on ? "var(--brand)" : "var(--line)"}`,
        background: on ? "var(--ok-bg)" : "transparent",
        cursor: "pointer",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 14, color: on ? "var(--brand-d)" : "var(--ink)" }}>
        {on ? "◉" : "○"} {title}
      </span>
      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{desc}</span>
    </button>
  );
}

function PromoList(props: {
  title: string;
  empty: string;
  promos: Promo[];
  busy: string | null;
  editing: string | null;
  editName: string; editPoints: string; editOnce: boolean;
  setEditName: (v: string) => void; setEditPoints: (v: string) => void; setEditOnce: (v: boolean) => void;
  onEdit: (p: Promo) => void;
  onSave: (id: string) => void;
  onCancel: () => void;
  onToggle: (p: Promo) => void;
}) {
  const { promos, busy, editing } = props;

  return (
    <div>
      <h3 style={{ fontSize: 15, margin: "0 0 10px", color: "var(--muted)" }}>{props.title}</h3>

      {promos.length === 0 ? (
        <p className="hint" style={{ textAlign: "left" }}>{props.empty}</p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {promos.map((p) => (
            <div key={p.id} className="card" style={{ padding: 16, opacity: p.is_active ? 1 : 0.65 }}>
              {editing === p.id ? (
                <div className="stack" style={{ gap: 10 }}>
                  <div className="form-group">
                    <label>ชื่อโปรโมชั่น</label>
                    <input type="text" className="input-text" value={props.editName}
                           onChange={(e) => props.setEditName(e.target.value)} maxLength={60} />
                  </div>
                  <div className="form-group">
                    <label>ได้กี่ดวง</label>
                    <input type="number" min="1" max="10" className="input-text" value={props.editPoints}
                           onChange={(e) => props.setEditPoints(e.target.value)} />
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      มีผลกับ QR ใบใหม่เท่านั้น ใบที่ออกไปแล้วติดจำนวนดวงไว้ในตัวมันแล้ว
                    </span>
                  </div>
                  <div className="form-group">
                    <label>ลูกค้าหนึ่งคนร่วมได้กี่ครั้ง</label>
                    <div style={{ display: "grid", gap: 8 }}>
                      <OnceChoice value={true} picked={props.editOnce} onPick={props.setEditOnce}
                        title="ครั้งเดียวเท่านั้น" desc="คนที่เคยรับแล้วสแกนไม่ได้อีก" />
                      <OnceChoice value={false} picked={props.editOnce} onPick={props.setEditOnce}
                        title="ร่วมซ้ำได้ไม่จำกัด" desc="มาเมื่อไหร่ก็รับได้อีก" />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="btn ghost small" style={{ width: "auto" }}
                            onClick={props.onCancel} disabled={busy !== null}>ยกเลิก</button>
                    <button className="btn small" style={{ width: "auto" }}
                            onClick={() => props.onSave(p.id)} disabled={busy !== null}>
                      {busy === p.id ? "กำลังบันทึก…" : "บันทึก"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</div>
                      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                        ปั๊ม <b style={{ color: "var(--brand-d)" }}>{p.points} ดวง</b> ·{" "}
                        {p.once_per_customer ? "ลูกค้าร่วมได้คนละครั้งเดียว" : "ลูกค้าร่วมซ้ำได้ไม่จำกัด"}
                      </div>
                      {p.note && (
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{p.note}</div>
                      )}
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                      whiteSpace: "nowrap",
                      background: p.is_active ? "var(--ok-bg)" : "#EEE",
                      color: p.is_active ? "var(--ok)" : "var(--muted)",
                    }}>
                      {p.is_active ? "เปิดอยู่" : "ปิดแล้ว"}
                    </span>
                  </div>

                  <div className="rows" style={{ marginTop: 12 }}>
                    <div className="row"><span>QR ที่ออกไปแล้ว</span><b>{p.issued} ใบ</b></div>
                    <div className="row"><span>ลูกค้าสแกนสำเร็จ</span><b>{p.claimed} ใบ</b></div>
                    <div className="row"><span>จำนวนลูกค้าที่ได้รับ</span><b>{p.customers} คน</b></div>
                    <div className="row"><span>ดวงที่แจกไปทั้งหมด</span><b>{p.stamps} ดวง</b></div>
                  </div>

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                    <button className="btn ghost small" style={{ width: "auto" }}
                            onClick={() => props.onEdit(p)} disabled={busy !== null}>แก้ไข</button>
                    <button className="btn ghost small" style={{ width: "auto" }}
                            onClick={() => props.onToggle(p)} disabled={busy !== null}>
                      {busy === p.id ? "กำลังบันทึก…" : p.is_active ? "ปิดโปรโมชั่น" : "เปิดอีกครั้ง"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * จัดการเดลิเวอรี่ — เจ้าของแก้เองได้ทุกอย่างโดยไม่ต้อง deploy
 *
 * ส่วนลดแก้ได้แค่เปิด/ปิด · เปอร์เซ็นต์กับช่วงเวลาห้ามแก้ย้อนหลัง เพราะออเดอร์เก่า
 * ผูกส่วนลดตัวนั้นไว้ ถ้าแก้ตัวเลขรายงานย้อนหลังจะไม่ตรงกับที่เก็บเงินจริง
 * อยากเปลี่ยนเงื่อนไขให้ปิดตัวเก่าแล้วสร้างตัวใหม่
 */

interface Zone { id: string; name: string; note: string | null; fee: number; is_active: boolean }
interface Item { id: string; kind: string; name: string; price: number; is_active: boolean }
interface Preset { grams: number; is_active: boolean }
interface Discount {
  id: string; name: string; percent: number; applies_to: string;
  starts_at: string; ends_at: string; is_active: boolean; live: boolean;
  used: number; saved: number;
}
interface Data {
  ok: boolean;
  settings: {
    enabled: boolean; open: boolean; price_per_100g: number;
    min_grams: number; grams_step: number; eta_min: number; eta_max: number;
    max_active: number | null; promptpay_set: boolean; cod_after_orders: number;
  };
  zones: Zone[]; items: Item[]; presets: Preset[]; discounts: Discount[];
  today: { orders: number; sales: number; cash: number; transfer: number; done: number; cancelled: number };
}

const KINDS = [
  { key: "ingredient", label: "วัตถุดิบ", priced: false },
  { key: "drink",      label: "เครื่องดื่ม", priced: true },
  { key: "spicy",      label: "ระดับความเผ็ด", priced: false },
  { key: "soup",       label: "น้ำซุป", priced: false },
] as const;

const REASONS: Record<string, string> = {
  name_required: "ต้องตั้งชื่อก่อน",
  key_not_allowed: "ค่านี้แก้จากหน้านี้ไม่ได้",
};

function baht(n: number) { return n.toLocaleString("th-TH"); }
function thaiDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

export default function DeliveryAdmin() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [newItem, setNewItem] = useState<{ kind: string; name: string; price: string }>(
    { kind: "ingredient", name: "", price: "0" });
  const [newZone, setNewZone] = useState({ name: "", note: "", fee: "" });
  const [newDisc, setNewDisc] = useState({ name: "", percent: "10", ends_at: "" });

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/delivery", { cache: "no-store" });
    if (res.ok) setD((await res.json()) as Data);
    else setErr("โหลดข้อมูลไม่สำเร็จ");
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(kind: string, data: unknown, ok: string) {
    setBusy(true); setErr(""); setMsg("");
    try {
      const res = await fetch("/api/admin/delivery", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, data }),
      });
      const r = (await res.json()) as { ok: boolean; reason?: string };
      if (!r.ok) { setErr(REASONS[r.reason ?? ""] ?? "บันทึกไม่สำเร็จ"); return false; }
      setMsg(ok); await load(); return true;
    } catch { setErr("เชื่อมต่อไม่ได้"); return false; }
    finally { setBusy(false); }
  }

  const setting = (key: string, value: unknown, label: string) =>
    save("setting", { key, value }, `บันทึก${label}แล้ว`);

  if (!d) return <p className="hint">กำลังโหลด…</p>;
  const s = d.settings;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, margin: 0 }}>เดลิเวอรี่</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          เมนู ค่าส่ง และส่วนลด แก้ที่นี่แล้วมีผลกับลูกค้าทันที ไม่ต้อง deploy
        </span>
      </div>

      {msg && (
        <div className="card" style={{ background: "var(--ok-bg)", borderColor: "#CDE3CB", padding: "12px 16px", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>{msg}</div>
      )}
      {err && <p className="err">{err}</p>}

      {!s.promptpay_set && (
        <div className="card" style={{ padding: 14, background: "#FDF3E3", borderColor: "#EBD9B6" }}>
          <b style={{ color: "var(--warn)" }}>ยังไม่ได้ตั้งเบอร์พร้อมเพย์</b>
          <p className="hint" style={{ textAlign: "left", margin: "4px 0 0" }}>
            ลูกค้าจะเลือกโอนเงินไม่ได้จนกว่าจะตั้งค่า
          </p>
        </div>
      )}

      {/* วันนี้ */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>วันนี้</h3>
        <div className="rows">
          <div className="row"><span>ออเดอร์ทั้งหมด</span><b>{d.today.orders}</b></div>
          <div className="row"><span>ส่งสำเร็จ</span><b>{d.today.done}</b></div>
          <div className="row"><span>ยกเลิก</span><b>{d.today.cancelled}</b></div>
          <div className="row"><span>เงินสด</span><b>{baht(d.today.cash)} ฿</b></div>
          <div className="row"><span>โอน</span><b>{baht(d.today.transfer)} ฿</b></div>
          <div className="row"><span><b>ยอดขายรวม</b></span><b>{baht(d.today.sales)} ฿</b></div>
        </div>
      </div>

      {/* เปิด/ปิด */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>การเปิดรับออเดอร์</h3>
        <div className="stack" style={{ gap: 10 }}>
          {([["enabled", "เปิดระบบเดลิเวอรี่", "ปิดแล้วลูกค้าจะไม่เห็นหน้าสั่งเลย"],
             ["open", "รับออเดอร์อยู่", "ปิดชั่วคราวเมื่อครัวแน่น พนักงานกดจากหน้าคิวได้ด้วย"]] as const).map(([k, t, h]) => {
            const on = k === "enabled" ? s.enabled : s.open;
            return (
              <button key={k} onClick={() => setting(`delivery_${k}`, !on, t)} disabled={busy}
                      className="card" style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, textAlign: "left", border: `1.5px solid ${on ? "var(--ok)" : "var(--line)"}` }}>
                <span>
                  <b style={{ fontSize: 14.5 }}>{t}</b>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{h}</span>
                </span>
                <span style={{ fontWeight: 700, color: on ? "var(--ok)" : "var(--muted)" }}>
                  {on ? "เปิด" : "ปิด"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ราคาและเวลา */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 4px" }}>ราคาและเวลา</h3>
        <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>
          เพิ่มน้ำหนักทีละ {s.grams_step} ก. เพื่อให้ราคาเป็นจำนวนเต็มเสมอ ไม่มีเศษสตางค์
        </p>
        <div className="stack" style={{ gap: 12 }}>
          {([["delivery_price_per_100g", "ราคาต่อ 100 กรัม (ขีดละ)", s.price_per_100g],
             ["delivery_min_grams", "น้ำหนักขั้นต่ำเมื่อกำหนดเอง (กรัม)", s.min_grams],
             ["delivery_eta_min", "เวลาส่งโดยประมาณ ต่ำสุด (นาที)", s.eta_min],
             ["delivery_eta_max", "เวลาส่งโดยประมาณ สูงสุด (นาที)", s.eta_max],
             ["delivery_cod_after_orders", "ต้องส่งสำเร็จกี่ครั้งก่อนจ่ายปลายทางได้ (0 = ให้ได้เลย)", s.cod_after_orders]] as const).map(([k, label, val]) => (
            <div className="form-group" key={k}>
              <label htmlFor={k}>{label}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id={k} type="number" className="input-text" defaultValue={val}
                       min={k === "delivery_cod_after_orders" ? 0 : 1} />
                <button className="btn small" style={{ width: "auto" }} disabled={busy}
                        onClick={() => {
                          const el = document.getElementById(k) as HTMLInputElement;
                          setting(k, parseInt(el.value, 10), label);
                        }}>บันทึก</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* โซน */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>โซนจัดส่งและค่าส่ง</h3>
        <div className="stack" style={{ gap: 8 }}>
          {d.zones.map((z) => (
            <div key={z.id} className="card" style={{ padding: 12, opacity: z.is_active ? 1 : 0.55 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <span>
                  <b>{z.name}</b>
                  {z.note && <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{z.note}</span>}
                </span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" className="input-text" style={{ width: 86 }}
                         id={`fee-${z.id}`} defaultValue={z.fee} min={0} />
                  <button className="btn small" style={{ width: "auto" }} disabled={busy}
                          onClick={() => {
                            const el = document.getElementById(`fee-${z.id}`) as HTMLInputElement;
                            save("zone", { id: z.id, name: z.name, note: z.note, fee: parseInt(el.value, 10) }, "บันทึกค่าส่งแล้ว");
                          }}>บันทึก</button>
                  <button className="btn ghost small" style={{ width: "auto" }} disabled={busy}
                          onClick={() => save("zone", { id: z.id, name: z.name, note: z.note, is_active: !z.is_active }, z.is_active ? "ปิดโซนแล้ว" : "เปิดโซนแล้ว")}>
                    {z.is_active ? "ปิด" : "เปิด"}
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            <b style={{ fontSize: 13.5 }}>เพิ่มโซนใหม่</b>
            <input className="input-text" placeholder="ชื่อโซน เช่น โซน D" value={newZone.name}
                   onChange={(e) => setNewZone({ ...newZone, name: e.target.value })} />
            <input className="input-text" placeholder="คำอธิบาย เช่น 10–15 กม." value={newZone.note}
                   onChange={(e) => setNewZone({ ...newZone, note: e.target.value })} />
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input-text" type="number" placeholder="ค่าส่ง" value={newZone.fee}
                     onChange={(e) => setNewZone({ ...newZone, fee: e.target.value })} />
              <button className="btn small" style={{ width: "auto" }} disabled={busy || !newZone.name.trim()}
                      onClick={async () => {
                        if (await save("zone", { name: newZone.name, note: newZone.note, fee: parseInt(newZone.fee || "0", 10) }, "เพิ่มโซนแล้ว"))
                          setNewZone({ name: "", note: "", fee: "" });
                      }}>เพิ่ม</button>
            </div>
          </div>
        </div>
      </div>

      {/* เมนู */}
      {KINDS.map((k) => {
        const list = d.items.filter((i) => i.kind === k.key);
        return (
          <div className="card" style={{ padding: 18 }} key={k.key}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>{k.label} ({list.filter((i) => i.is_active).length})</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {list.map((i) => (
                <button key={i.id} className="chip-pick" data-on={i.is_active} disabled={busy}
                        onClick={() => save("item", { id: i.id, name: i.name, is_active: !i.is_active }, i.is_active ? `ปิด ${i.name} แล้ว` : `เปิด ${i.name} แล้ว`)}>
                  {i.name}{k.priced ? ` · ${baht(i.price)} ฿` : ""}
                </button>
              ))}
              {list.length === 0 && <p className="hint" style={{ textAlign: "left" }}>ยังไม่มีรายการ</p>}
            </div>
            <p className="hint" style={{ textAlign: "left", fontSize: 12, marginTop: 8 }}>
              แตะเพื่อเปิด/ปิด — ของหมดวันนี้ปิดไว้ก่อนได้ ลูกค้าจะไม่เห็นทันที
            </p>
          </div>
        );
      })}

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>เพิ่มรายการใหม่</h3>
        <div className="stack" style={{ gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {KINDS.map((k) => (
              <button key={k.key} className="chip-pick" data-on={newItem.kind === k.key}
                      onClick={() => setNewItem({ ...newItem, kind: k.key })}>{k.label}</button>
            ))}
          </div>
          <input className="input-text" placeholder="ชื่อรายการ" value={newItem.name}
                 onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
          {newItem.kind === "drink" && (
            <input className="input-text" type="number" placeholder="ราคา" value={newItem.price}
                   onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} />
          )}
          <button className="btn small" style={{ width: "auto", alignSelf: "flex-end" }}
                  disabled={busy || !newItem.name.trim()}
                  onClick={async () => {
                    if (await save("item", { kind: newItem.kind, name: newItem.name, price: parseInt(newItem.price || "0", 10) }, "เพิ่มรายการแล้ว"))
                      setNewItem({ ...newItem, name: "", price: "0" });
                  }}>เพิ่ม</button>
        </div>
      </div>

      {/* ส่วนลด */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 4px" }}>ส่วนลด</h3>
        <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>
          หมดอายุเองตามวันที่ตั้งไว้ ไม่ต้องมาปิดเอง · เปอร์เซ็นต์กับช่วงเวลาแก้ย้อนหลังไม่ได้
          เพราะออเดอร์เก่าผูกไว้ อยากเปลี่ยนให้ปิดตัวเก่าแล้วสร้างใหม่
        </p>

        <div className="stack" style={{ gap: 8 }}>
          {d.discounts.map((x) => (
            <div key={x.id} className="card" style={{ padding: 12, opacity: x.is_active ? 1 : 0.55 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <span>
                  <b>{x.name}</b>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>
                    ลด {x.percent}% {x.applies_to === "grand" ? "ของยอดรวม" : "ของค่าอาหาร"} ·{" "}
                    {thaiDate(x.starts_at)} – {thaiDate(x.ends_at)}
                  </span>
                  <span style={{ display: "block", fontSize: 12.5, marginTop: 4 }}>
                    ใช้ไป {x.used} ออเดอร์ · ลดไปรวม {baht(x.saved)} ฿
                  </span>
                </span>
                <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap",
                                 background: x.live ? "var(--ok-bg)" : "#EEE", color: x.live ? "var(--ok)" : "var(--muted)" }}>
                    {x.live ? "ใช้อยู่ตอนนี้" : x.is_active ? "ยังไม่ถึงเวลา / หมดอายุ" : "ปิดแล้ว"}
                  </span>
                  <button className="btn ghost small" style={{ width: "auto" }} disabled={busy}
                          onClick={() => save("discount", { id: x.id, is_active: !x.is_active }, x.is_active ? "ปิดส่วนลดแล้ว" : "เปิดส่วนลดแล้ว")}>
                    {x.is_active ? "ปิด" : "เปิด"}
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            <b style={{ fontSize: 13.5 }}>สร้างส่วนลดใหม่</b>
            <input className="input-text" placeholder="ชื่อ เช่น ส่วนลดพฤศจิกายน" value={newDisc.name}
                   onChange={(e) => setNewDisc({ ...newDisc, name: e.target.value })} />
            <div style={{ display: "flex", gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="dp">ลดกี่ %</label>
                <input id="dp" className="input-text" type="number" min={1} max={100} value={newDisc.percent}
                       onChange={(e) => setNewDisc({ ...newDisc, percent: e.target.value })} />
              </div>
              <div className="form-group" style={{ flex: 2 }}>
                <label htmlFor="de">หมดอายุวันที่</label>
                <input id="de" className="input-text" type="date" value={newDisc.ends_at}
                       onChange={(e) => setNewDisc({ ...newDisc, ends_at: e.target.value })} />
              </div>
            </div>
            <button className="btn small" style={{ width: "auto", alignSelf: "flex-end" }}
                    disabled={busy || !newDisc.name.trim() || !newDisc.ends_at}
                    onClick={async () => {
                      // สิ้นสุดตอนเที่ยงคืนของวันถัดไป เพื่อให้วันที่เลือกยังใช้ได้ทั้งวัน
                      const end = new Date(`${newDisc.ends_at}T00:00:00+07:00`);
                      end.setDate(end.getDate() + 1);
                      if (await save("discount", {
                        name: newDisc.name, percent: parseInt(newDisc.percent, 10),
                        applies_to: "food", ends_at: end.toISOString(),
                      }, "สร้างส่วนลดแล้ว")) setNewDisc({ name: "", percent: "10", ends_at: "" });
                    }}>สร้าง</button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * คิวออเดอร์เดลิเวอรี่ของพนักงาน
 *
 * ถามสถานะทุก 5 วินาทีเหมือนจอ QR — ออเดอร์ใหม่ต้องโผล่เองโดยพนักงานไม่ต้องกดรีเฟรช
 * ไม่งั้นลูกค้าสั่งแล้วรอจนเย็นชืดโดยไม่มีใครเห็น
 *
 * ลำดับสถานะบังคับที่ฐานข้อมูล หน้านี้แค่ยิงคำสั่งแล้วแสดงผลที่ได้กลับมา
 */

interface Item {
  name: string; qty: number; total: number;
  spicy: string | null; soup: string | null; ingredients: string[];
}
interface Order {
  id: string; order_no: string; status: string; created_at: string;
  customer: string; phone: string; address: string; rider_note: string | null;
  lat: number | null; lng: number | null; zone: string;
  food_total: number; delivery_fee: number; discount: number; grand_total: number;
  pay_method: "cod" | "transfer";
  has_slip: boolean; slip_ref: string | null; paid: boolean;
  rider: string | null; stamped: boolean;
  items: Item[];
}
interface Queue {
  ok: boolean; open: boolean; done_today: number;
  counts: { placed: number; accepted: number; cooking: number; out: number };
  orders: Order[];
}

const TABS = [
  { key: "placed",   label: "ใหม่" },
  { key: "accepted", label: "รับแล้ว" },
  { key: "cooking",  label: "กำลังทำ" },
  { key: "out",      label: "ออกส่ง" },
] as const;

/** ปุ่มถัดไปของแต่ละสถานะ — ข้อความบอกสิ่งที่จะเกิดขึ้น ไม่ใช่ชื่อสถานะ */
const NEXT: Record<string, { to: string; label: string } | undefined> = {
  placed:   { to: "accepted", label: "รับออเดอร์" },
  accepted: { to: "cooking",  label: "เริ่มทำอาหาร" },
  cooking:  { to: "out",      label: "ออกไปส่ง" },
};

const REASONS: Record<string, string> = {
  payment_not_confirmed: "ยังไม่ได้ยืนยันว่าเงินเข้า — กดดูสลิปแล้วเทียบกับแอปธนาคารก่อน",
  rider_required: "ต้องระบุคนขับก่อน",
  bad_transition: "สถานะเปลี่ยนไปแล้ว ดึงข้อมูลใหม่อีกครั้ง",
  already_delivered: "ออเดอร์นี้ปิดงานไปแล้ว",
};

function baht(n: number) { return n.toLocaleString("th-TH"); }

function waited(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "เพิ่งเข้ามา";
  if (m < 60) return `รอ ${m} นาที`;
  return `รอ ${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
}

export default function DeliveryQueue() {
  const router = useRouter();
  const [q, setQ] = useState<Queue | null>(null);
  const [tab, setTab] = useState<string>("placed");
  const [open, setOpen] = useState<Order | null>(null);
  const [slip, setSlip] = useState<{ b64: string; mime: string; ref: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/delivery", { cache: "no-store" });
      if (res.status === 401) { router.replace("/staff/login?next=/staff/delivery"); return; }
      if (!res.ok) return;
      const d = (await res.json()) as Queue;
      setQ(d);
      // ถ้ากำลังเปิดรายละเอียดอยู่ ให้ข้อมูลในจอนั้นสดตามไปด้วย
      setOpen((cur) => (cur ? d.orders.find((o) => o.id === cur.id) ?? null : null));
    } catch { /* เน็ตสะดุดชั่วคราว รอบถัดไปค่อยว่ากัน */ }
  }, [router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function send(id: string, body: unknown, okMsg?: string) {
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/staff/delivery/${id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as { ok: boolean; reason?: string };
      if (!d.ok) { setErr(REASONS[d.reason ?? ""] ?? "ทำรายการไม่สำเร็จ"); return false; }
      if (okMsg) setErr("");
      await load();
      return true;
    } catch { setErr("เชื่อมต่อไม่ได้"); return false; }
    finally { setBusy(false); }
  }

  async function toggleOpen() {
    if (!q) return;
    setBusy(true);
    await fetch("/api/staff/delivery/open", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ open: !q.open }),
    });
    await load();
    setBusy(false);
  }

  async function showSlip(o: Order) {
    setSlip(null);
    const res = await fetch(`/api/staff/delivery/${o.id}`);
    if (res.ok) setSlip((await res.json()) as { b64: string; mime: string; ref: string | null });
  }

  if (!q) {
    return (
      <div className="screen">
        <div className="topbar"><h1>ออเดอร์เดลิเวอรี่</h1></div>
        <div className="grow center"><p className="hint">กำลังโหลด…</p></div>
      </div>
    );
  }

  // ───────── รายละเอียดออเดอร์ ─────────
  if (open) {
    const next = NEXT[open.status];
    const needPay = open.pay_method === "transfer" && !open.paid;

    return (
      <div className="screen">
        <div className="topbar">
          <div>
            <h1>{open.order_no}</h1>
            <div className="who">{open.zone} · {waited(open.created_at)}</div>
          </div>
          <button className="btn ghost small" style={{ width: "auto" }}
                  onClick={() => { setOpen(null); setSlip(null); setErr(""); }}>ปิด</button>
        </div>

        {err && <p className="err" style={{ marginBottom: 10 }}>{err}</p>}

        <div className="stack" style={{ gap: 10, overflowY: "auto" }}>
          {open.items.map((it, i) => (
            <div className="card" key={i} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <b style={{ fontSize: 15 }}>{it.name} × {it.qty}</b>
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{baht(it.total)} ฿</b>
              </div>
              {(it.spicy || it.soup) && (
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                  {[it.spicy, it.soup].filter(Boolean).join(" · ")}
                </div>
              )}
              {it.ingredients.length > 0 && (
                <div style={{ fontSize: 13, marginTop: 4 }}>{it.ingredients.join(" · ")}</div>
              )}
            </div>
          ))}

          <div className="card" style={{ padding: 12 }}>
            <div className="rows">
              <div className="row"><span>ลูกค้า</span><b>{open.customer}</b></div>
              <div className="row"><span>ที่อยู่</span><b style={{ textAlign: "right" }}>{open.address}</b></div>
              {open.rider_note && (
                <div className="row"><span>ฝากบอกคนขับ</span><b>{open.rider_note}</b></div>
              )}
              <div className="row"><span>ค่าอาหาร</span><b>{baht(open.food_total)} ฿</b></div>
              <div className="row"><span>ค่าส่ง</span><b>{baht(open.delivery_fee)} ฿</b></div>
              {open.discount > 0 && (
                <div className="row"><span>ส่วนลด</span><b style={{ color: "var(--ok)" }}>−{baht(open.discount)} ฿</b></div>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <a className="btn ghost small" style={{ textDecoration: "none" }}
               href={`tel:${open.phone.replace(/\D/g, "")}`}>โทรหาลูกค้า</a>
            <a className="btn ghost small"
               style={{ textDecoration: "none", opacity: open.lat ? 1 : 0.45, pointerEvents: open.lat ? "auto" : "none" }}
               target="_blank" rel="noreferrer"
               href={`https://www.google.com/maps/search/?api=1&query=${open.lat},${open.lng}`}>
              {open.lat ? "เปิดแผนที่" : "ไม่ได้ปักหมุด"}
            </a>
          </div>

          {open.pay_method === "cod" ? (
            <div className="card" style={{ padding: 14, textAlign: "center", background: "#FDF3E3", borderColor: "#EBD9B6" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--warn)" }}>เก็บเงินปลายทาง</span>
              <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {baht(open.grand_total)} ฿
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <b>โอนพร้อมเพย์ {baht(open.grand_total)} ฿</b>
                  <div style={{ fontSize: 13, color: open.paid ? "var(--ok)" : "var(--warn)" }}>
                    {open.paid ? "ยืนยันเงินเข้าแล้ว" : open.has_slip ? "แนบสลิปแล้ว รอตรวจ" : "ยังไม่แนบสลิป"}
                  </div>
                </div>
                {open.has_slip && !slip && (
                  <button className="btn small" style={{ width: "auto" }} onClick={() => showSlip(open)}>ดูสลิป</button>
                )}
              </div>

              {slip && (
                <div style={{ marginTop: 10 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:${slip.mime};base64,${slip.b64}`} alt="สลิปโอนเงิน"
                       style={{ width: "100%", borderRadius: 10, border: "1px solid var(--line)" }} />
                  <p className="hint" style={{ textAlign: "left", fontSize: 12, marginTop: 8 }}>
                    {slip.ref
                      ? `อ่านเลขอ้างอิงได้ · ${slip.ref} · ยังไม่เคยถูกใช้`
                      : "อ่านเลขอ้างอิงจากสลิปไม่ได้ — ดูให้ละเอียดกว่าปกติ"}
                    <br />
                    <b>ระบบเช็คได้แค่ว่าสลิปไม่ซ้ำ · ยืนยันว่าเงินเข้าจริงต้องดูแอปธนาคาร</b>
                  </p>
                  {!open.paid && (
                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      <button className="btn" disabled={busy}
                              onClick={() => send(open.id, { action: "payment", ok: true })}>
                        เงินเข้าแล้ว
                      </button>
                      <button className="btn ghost small" disabled={busy}
                              onClick={() => { if (confirm("ยกเลิกออเดอร์นี้เพราะสลิปไม่ถูกต้องใช่ไหม")) send(open.id, { action: "payment", ok: false }); }}>
                        สลิปไม่ถูกต้อง · ยกเลิกออเดอร์
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grow" />
        <div className="stack" style={{ gap: 8 }}>
          {next && (
            <button className="btn" disabled={busy || (next.to === "accepted" && needPay)}
                    onClick={() => send(open.id, { to: next.to })}>
              {next.label}
            </button>
          )}
          {open.status === "out" && (
            <button className="btn" disabled={busy} onClick={() => send(open.id, { to: "delivered" })}>
              ส่งถึงแล้ว{open.pay_method === "cod" ? ` · เก็บเงิน ${baht(open.grand_total)} ฿ ครบ` : ""}
            </button>
          )}
          {next?.to === "accepted" && needPay && (
            <p className="hint" style={{ fontSize: 12 }}>กดรับไม่ได้จนกว่าจะยืนยันว่าเงินเข้า</p>
          )}
          <button className="btn ghost small" disabled={busy}
                  onClick={() => { const r = prompt("ยกเลิกเพราะอะไร"); if (r) send(open.id, { to: "cancelled", reason: r }); }}>
            ยกเลิกออเดอร์
          </button>
        </div>
      </div>
    );
  }

  // ───────── คิว ─────────
  const list = q.orders.filter((o) => o.status === tab);

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>ออเดอร์เดลิเวอรี่</h1>
          <div className="who">ส่งแล้ววันนี้ {q.done_today} ออเดอร์</div>
        </div>
        <button className="btn ghost small" style={{ width: "auto" }}
                onClick={() => router.replace("/staff")}>ปิด</button>
      </div>

      {err && <p className="err" style={{ marginBottom: 10 }}>{err}</p>}

      <button type="button" onClick={toggleOpen} disabled={busy}
              className="card"
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, padding: "12px 14px", width: "100%", textAlign: "left",
                border: `1.5px solid ${q.open ? "var(--ok)" : "var(--stamp)"}`,
              }}>
        <span>
          <b style={{ fontSize: 15 }}>{q.open ? "รับออเดอร์อยู่" : "ปิดรับออเดอร์ชั่วคราว"}</b>
          <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
            {q.open ? "แตะเพื่อปิดเมื่อครัวแน่น" : "ลูกค้าสั่งไม่ได้จนกว่าจะเปิดใหม่"}
          </span>
        </span>
        <span style={{
          width: 48, height: 28, borderRadius: 999, flex: "0 0 auto", position: "relative",
          background: q.open ? "var(--ok)" : "#CCC",
        }}>
          <span style={{
            position: "absolute", top: 3, [q.open ? "right" : "left"]: 3,
            width: 22, height: 22, borderRadius: "50%", background: "#fff",
          } as React.CSSProperties} />
        </span>
      </button>

      <div style={{ display: "flex", gap: 6, margin: "12px 0" }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
                  className="card"
                  style={{
                    flex: 1, padding: "7px 4px", textAlign: "center", fontSize: 12.5,
                    border: `1px solid ${tab === t.key ? "var(--brand)" : "var(--line)"}`,
                    background: tab === t.key ? "var(--ok-bg)" : "var(--surface)",
                  }}>
            {t.label}
            <b style={{ display: "block", fontSize: 17, fontVariantNumeric: "tabular-nums" }}>
              {q.counts[t.key]}
            </b>
          </button>
        ))}
      </div>

      <div className="stack" style={{ gap: 10, overflowY: "auto" }}>
        {list.length === 0 && <p className="hint" style={{ textAlign: "left" }}>ไม่มีออเดอร์ในขั้นนี้</p>}
        {list.map((o) => {
          const late = (Date.now() - new Date(o.created_at).getTime()) / 60000 > 3;
          return (
            <button key={o.id} onClick={() => { setOpen(o); setSlip(null); setErr(""); }}
                    className="card"
                    style={{
                      padding: 12, width: "100%", textAlign: "left",
                      borderLeft: late && o.status === "placed" ? "4px solid var(--stamp)" : undefined,
                    }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b style={{ fontFamily: "monospace", fontSize: 13 }}>{o.order_no}</b>
                <span style={{ fontSize: 12, color: late && o.status === "placed" ? "var(--stamp)" : "var(--muted)",
                               fontWeight: late && o.status === "placed" ? 700 : 400 }}>
                  {waited(o.created_at)}
                </span>
              </div>
              <div style={{ fontSize: 13.5, marginTop: 4 }}>
                {o.items.map((i) => `${i.name} × ${i.qty}`).join(" · ")}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {o.zone} · {o.address.slice(0, 40)}{o.address.length > 40 ? "…" : ""}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6,
                            color: o.pay_method === "cod" ? "var(--warn)" : o.paid ? "var(--ok)" : "var(--warn)" }}>
                {o.pay_method === "cod"
                  ? `เงินสดปลายทาง · ${baht(o.grand_total)} ฿`
                  : o.paid ? `โอนแล้ว ยืนยันแล้ว · ${baht(o.grand_total)} ฿`
                           : o.has_slip ? `แนบสลิปแล้ว รอตรวจ · ${baht(o.grand_total)} ฿`
                                        : `รอลูกค้าแนบสลิป · ${baht(o.grand_total)} ฿`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

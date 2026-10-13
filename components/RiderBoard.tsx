"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * หน้าคนขับ — แยกจากหน้าคิวของเคาน์เตอร์
 *
 * คนขับใช้ตอนยืนอยู่หน้าร้านหรือจอดข้างทาง มือถืออยู่ในมืออีกข้าง
 * จึงต้องอ่านออกในแวบเดียวและปุ่มใหญ่พอกดด้วยนิ้วโป้งข้างเดียว
 *
 * เห็นสองกอง: งานที่ครัวทำเสร็จรอหยิบ กับงานที่ตัวเองกำลังไปส่ง
 * สิ่งที่ลืมแล้วเสียเงินจริงคือ "เก็บเงินปลายทาง" จึงขึ้นตัวใหญ่สุดเสมอ
 */

interface Item { name: string; qty: number }
interface Order {
  id: string; order_no: string; status: string;
  customer: string; phone: string; address: string; rider_note: string | null;
  lat: number | null; lng: number | null; zone: string;
  grand_total: number; pay_method: "cod" | "transfer"; paid: boolean;
  rider: string | null; out_at: string | null; items: Item[];
}
interface Queue { ok: boolean; orders: Order[]; done_today: number }

const REASONS: Record<string, string> = {
  bad_transition: "ออเดอร์นี้ถูกคนอื่นหยิบไปแล้ว",
  rider_required: "ต้องระบุคนขับก่อน",
};

const baht = (n: number) => n.toLocaleString("th-TH");

function since(iso: string | null) {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "เพิ่งออก" : `ออกไปแล้ว ${m} นาที`;
}

export default function RiderBoard() {
  const router = useRouter();
  const [q, setQ] = useState<Queue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/delivery", { cache: "no-store" });
      if (res.status === 401) { router.replace("/staff/login?next=/staff/rider"); return; }
      if (res.ok) setQ((await res.json()) as Queue);
    } catch { /* เน็ตสะดุด รอบหน้าค่อยว่ากัน */ }
  }, [router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(o: Order, to: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(o.id); setErr("");
    try {
      const res = await fetch(`/api/staff/delivery/${o.id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const d = (await res.json()) as { ok: boolean; reason?: string };
      if (!d.ok) setErr(REASONS[d.reason ?? ""] ?? "ทำรายการไม่สำเร็จ");
      await load();
    } catch { setErr("เชื่อมต่อไม่ได้"); }
    finally { setBusy(null); }
  }

  if (!q) {
    return (
      <div className="screen">
        <div className="topbar"><h1>งานส่งของ</h1></div>
        <div className="grow center"><p className="hint">กำลังโหลด…</p></div>
      </div>
    );
  }

  const ready = q.orders.filter((o) => o.status === "cooking");
  const mine  = q.orders.filter((o) => o.status === "out");

  const card = (o: Order, mode: "ready" | "mine") => (
    <div className="card" key={o.id} style={{ padding: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <b style={{ fontFamily: "monospace", fontSize: 14 }}>{o.order_no}</b>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {mode === "mine" ? since(o.out_at) : o.zone}
        </span>
      </div>

      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{o.customer}</div>
        <div style={{ fontSize: 14, marginTop: 2 }}>{o.address}</div>
        {o.rider_note && (
          <div style={{ fontSize: 13, color: "var(--warn)", fontWeight: 600, marginTop: 4 }}>
            {o.rider_note}
          </div>
        )}
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
          {o.items.map((i) => `${i.name} × ${i.qty}`).join(" · ")}
        </div>
      </div>

      {/* สิ่งที่ลืมแล้วเสียเงินจริง — ตัวใหญ่สุดในการ์ดเสมอ */}
      <div style={{
        borderRadius: 12, padding: "10px 12px", textAlign: "center",
        background: o.pay_method === "cod" ? "#FDF3E3" : "var(--ok-bg)",
        border: `1px solid ${o.pay_method === "cod" ? "#EBD9B6" : "#CDE3CB"}`,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: o.pay_method === "cod" ? "var(--warn)" : "var(--ok)" }}>
          {o.pay_method === "cod" ? "เก็บเงินปลายทาง" : "โอนมาแล้ว ไม่ต้องเก็บเงิน"}
        </span>
        <div style={{ fontSize: o.pay_method === "cod" ? 28 : 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {baht(o.grand_total)} ฿
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <a className="btn ghost small" style={{ textDecoration: "none" }}
           href={`tel:${o.phone.replace(/\D/g, "")}`}>โทรหาลูกค้า</a>
        <a className="btn ghost small"
           style={{ textDecoration: "none", opacity: o.lat ? 1 : 0.4, pointerEvents: o.lat ? "auto" : "none" }}
           target="_blank" rel="noreferrer"
           href={`https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`}>
          {o.lat ? "นำทาง" : "ไม่ได้ปักหมุด"}
        </a>
      </div>

      {mode === "ready" ? (
        <button className="btn" disabled={busy !== null} onClick={() => act(o, "out")}>
          {busy === o.id ? "กำลังบันทึก…" : "รับไปส่ง"}
        </button>
      ) : (
        <button className="btn" disabled={busy !== null}
                onClick={() => act(o, "delivered",
                  o.pay_method === "cod"
                    ? `ส่งถึงแล้วและเก็บเงินครบ ${baht(o.grand_total)} บาทใช่ไหม`
                    : "ส่งถึงแล้วใช่ไหม")}>
          {busy === o.id ? "กำลังบันทึก…"
            : o.pay_method === "cod" ? `ส่งถึงแล้ว · เก็บเงิน ${baht(o.grand_total)} ฿ ครบ` : "ส่งถึงแล้ว"}
        </button>
      )}
    </div>
  );

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>งานส่งของ</h1>
          <div className="who">ส่งแล้ววันนี้ {q.done_today} ออเดอร์</div>
        </div>
        <button className="btn ghost small" style={{ width: "auto" }}
                onClick={() => router.replace("/staff")}>ปิด</button>
      </div>

      {err && <p className="err" style={{ marginBottom: 10 }}>{err}</p>}

      <div className="stack" style={{ gap: 16, overflowY: "auto" }}>
        <div>
          <h2 style={{ fontSize: 15, margin: "0 0 8px", color: "var(--muted)" }}>
            กำลังไปส่ง ({mine.length})
          </h2>
          {mine.length === 0
            ? <p className="hint" style={{ textAlign: "left" }}>ยังไม่มีงานที่รับไว้</p>
            : <div className="stack" style={{ gap: 10 }}>{mine.map((o) => card(o, "mine"))}</div>}
        </div>

        <div>
          <h2 style={{ fontSize: 15, margin: "0 0 8px", color: "var(--muted)" }}>
            ครัวทำเสร็จ รอหยิบ ({ready.length})
          </h2>
          {ready.length === 0
            ? <p className="hint" style={{ textAlign: "left" }}>ยังไม่มีงานรอ</p>
            : <div className="stack" style={{ gap: 10 }}>{ready.map((o) => card(o, "ready"))}</div>}
        </div>
      </div>
    </div>
  );
}

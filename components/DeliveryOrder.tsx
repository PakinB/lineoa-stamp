"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { initLiff, accessToken } from "@/lib/liff";
import { promptPayPayload } from "@/lib/promptpay";
import { shrinkImage, readSlipRef } from "@/lib/slip";

/**
 * สั่งเดลิเวอรี่ — เปิดเป็น LIFF ในแชท LINE
 *
 * ริชเมนูมีช่องเดียว หน้านี้จึงทำสองหน้าที่: ถ้ามีออเดอร์ที่ยังไม่ถึง ขึ้นแถบ
 * สถานะให้กดดูได้ทันที ถ้าไม่มีก็เข้าสั่งของเลย
 *
 * **ราคาทุกบาทมาจากเซิร์ฟเวอร์** หน้านี้ไม่คำนวณเองสักบรรทัด (หลักการข้อ 3)
 * ทุกครั้งที่ตะกร้าหรือโซนเปลี่ยน จะถามราคาใหม่แล้ววาดตามที่ได้มา
 */

type Phase =
  | "loading" | "consent" | "closed"
  | "menu" | "detail" | "cart" | "address" | "confirm" | "track" | "error";

interface Preset { grams: number; price: number }
interface Zone { id: string; name: string; note: string | null; fee: number }
interface Drink { id: string; name: string; price: number }
interface Menu {
  ok: boolean; consented: boolean; enabled: boolean; open: boolean;
  cod_allowed: boolean; delivered_count: number; cod_after_orders: number;
  eta: { min: number; max: number };
  price_per_100g: number; min_grams: number; grams_step: number;
  presets: Preset[]; zones: Zone[];
  ingredients: string[]; spicy: string[]; soups: string[]; drinks: Drink[];
  discount: { name: string; percent: number; ends_at: string } | null;
  active_order: { id: string; order_no: string; status: string } | null;
}

type Line =
  | { kind: "mala"; grams: number; qty: number; spicy: string; soup: string; ingredients: string[] }
  | { kind: "drink"; item_id: string; name: string; qty: number };

interface QuoteLine {
  kind: string; name: string; qty: number; total: number;
  spicy: string | null; soup: string | null; ingredients: string[];
}
interface Quote {
  ok: boolean; lines: QuoteLine[];
  food_total: number; delivery_fee: number; discount: number; grand_total: number;
  discount_info: { name: string; percent: number } | null;
  zone: { name: string; note: string | null; fee: number };
}

interface Track {
  ok: boolean;
  order: {
    id: string; order_no: string; status: string; grand_total: number;
    food_total: number; delivery_fee: number; discount: number;
    pay_method: "cod" | "transfer"; paid: boolean; has_slip: boolean;
    created_at: string; accepted_at: string | null; cooking_at: string | null;
    out_at: string | null; delivered_at: string | null; cancel_reason: string | null;
    rider: string | null; zone: string; address: string;
    items: QuoteLine[];
  };
  promptpay_id: string | null;
  shop_phone: string | null;
  eta_min: number; eta_max: number;
}

const REASONS: Record<string, string> = {
  closed_now: "ร้านปิดรับออเดอร์ชั่วคราว ลองใหม่อีกสักครู่",
  delivery_disabled: "ยังไม่เปิดให้สั่งเดลิเวอรี่",
  too_many_open_orders: "คุณมีออเดอร์ที่ยังไม่ถึงอยู่แล้ว รอให้ส่งเสร็จก่อนนะ",
  shop_full: "ตอนนี้ออเดอร์เต็ม ลองใหม่อีกสักครู่",
  bad_weight: "น้ำหนักไม่ถูกต้อง",
  empty_cart: "ยังไม่ได้เลือกอะไรเลย",
  address_required: "กรอกที่อยู่ก่อนนะ",
  phone_required: "กรอกเบอร์โทรก่อนนะ",
  need_consent: "ต้องยินยอมก่อนจึงจะสั่งได้",
  account_blocked: "บัญชีนี้ถูกระงับ ติดต่อร้านได้เลย",
  slip_already_used: "สลิปใบนี้ถูกใช้ไปแล้ว ส่งใบที่โอนจริงของออเดอร์นี้นะ",
  image_too_big: "รูปใหญ่เกินไป ลองถ่ายใหม่",
  already_paid: "ออเดอร์นี้ยืนยันการชำระแล้ว",
  cod_locked: "ครั้งแรกต้องโอนก่อนนะ ส่งถึงแล้วครั้งหน้าจ่ายปลายทางได้เลย",
};

const STEPS = [
  { key: "placed",    label: "ร้านรับออเดอร์แล้ว" },
  { key: "cooking",   label: "กำลังทำอาหาร" },
  { key: "out",       label: "ออกจากร้านแล้ว" },
  { key: "delivered", label: "ถึงที่หมาย" },
];

function baht(n: number) { return n.toLocaleString("th-TH"); }
function bowls(g: number) { return g >= 800 ? "🍲🍲🍲" : g >= 500 ? "🍲🍲" : "🍲"; }
function hhmm(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
}

async function api(url: string, init?: RequestInit) {
  const token = accessToken();
  return fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function DeliveryOrder() {
  const params = useSearchParams();
  const deepOrder = params.get("o");

  const [phase, setPhase] = useState<Phase>("loading");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [qrPng, setQrPng] = useState<string>();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // ร่างหมาล่าที่กำลังประกอบอยู่
  const [grams, setGrams] = useState(500);
  const [spicy, setSpicy] = useState("");
  const [soup, setSoup] = useState("");
  const [ings, setIngs] = useState<string[]>([]);

  // ที่อยู่
  const [zoneId, setZoneId] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pay, setPay] = useState<"cod" | "transfer">("cod");

  // ---------- โหลดเมนู ----------
  const loadMenu = useCallback(async () => {
    const res = await api("/api/delivery/menu");
    const d = (await res.json()) as Menu;
    if (!d.ok) { setMsg(REASONS[(d as unknown as { reason: string }).reason] ?? "เปิดหน้าไม่ได้"); setPhase("error"); return null; }
    setMenu(d);
    if (!d.zones.length) { setMsg("ยังไม่ได้ตั้งโซนจัดส่ง"); setPhase("error"); return d; }
    setZoneId((z) => z || d.zones[0].id);
    setGrams((g) => (d.presets.length ? d.presets[Math.min(1, d.presets.length - 1)].grams : g));
    setSpicy((s) => s || d.spicy[0] || "");
    setSoup((s) => s || d.soups[0] || "");
    // ลูกค้าใหม่ยังจ่ายปลายทางไม่ได้ ตั้งเริ่มต้นเป็นโอนไปเลย จะได้ไม่ต้องมากดเปลี่ยน
    if (!d.cod_allowed) setPay("transfer");
    return d;
  }, []);

  // ---------- ติดตามออเดอร์ ----------
  const loadTrack = useCallback(async (id: string) => {
    const res = await api(`/api/delivery/orders/${id}`);
    if (!res.ok) return;
    const d = (await res.json()) as Track;
    setTrack(d);
    setPhase("track");
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        // หน้านี้เป็น LIFF app คนละตัวกับหน้าบัตรสะสม เพราะ endpoint คนละ URL
        // ยังไม่ได้ตั้ง NEXT_PUBLIC_LIFF_ID_ORDER ก็ถอยไปใช้ตัวหลักให้หน้ายังเปิดได้
        await initLiff(process.env.NEXT_PUBLIC_LIFF_ID_ORDER);
        const d = await loadMenu();
        if (!d) return;
        if (!d.consented) { setPhase("consent"); return; }
        if (deepOrder) { await loadTrack(deepOrder); return; }
        if (d.active_order) { await loadTrack(d.active_order.id); return; }
        setPhase(d.enabled && d.open ? "menu" : "closed");
      } catch {
        setMsg("เปิดหน้าไม่ได้ ลองใหม่อีกครั้ง");
        setPhase("error");
      }
    })();
  }, [deepOrder, loadMenu, loadTrack]);

  // ติดตามสถานะสด ๆ ระหว่างเปิดหน้าค้างไว้ — ไม่ต้อง push ข้อความให้เปลืองโควตา
  useEffect(() => {
    if (phase !== "track" || !track) return;
    if (["delivered", "cancelled"].includes(track.order.status)) return;
    const t = setInterval(() => loadTrack(track.order.id), 15000);
    return () => clearInterval(t);
  }, [phase, track, loadTrack]);

  // สร้าง QR พร้อมเพย์ในเครื่อง ไม่ผ่านตัวกลาง จึงไม่เสียค่าธรรมเนียม
  useEffect(() => {
    if (!track?.promptpay_id) { setQrPng(undefined); return; }
    QRCode.toDataURL(promptPayPayload(track.promptpay_id, track.order.grand_total), {
      margin: 1, width: 560, color: { dark: "#23404F", light: "#FFFFFF" },
    }).then(setQrPng).catch(() => setQrPng(undefined));
  }, [track]);

  // ---------- ถามราคาใหม่ทุกครั้งที่ตะกร้าหรือโซนเปลี่ยน ----------
  const refreshQuote = useCallback(async (lines: Line[], zone: string) => {
    if (!lines.length || !zone) { setQuote(null); return; }
    const res = await api("/api/delivery/quote", {
      method: "POST", body: JSON.stringify({ zone_id: zone, items: lines }),
    });
    const d = (await res.json()) as Quote;
    setQuote(d.ok ? d : null);
  }, []);
  useEffect(() => { refreshQuote(cart, zoneId); }, [cart, zoneId, refreshQuote]);

  async function consent() {
    setBusy(true);
    await api("/api/me/consent", { method: "POST", body: "{}" });
    const d = await loadMenu();
    setBusy(false);
    if (d) setPhase(d.enabled && d.open ? "menu" : "closed");
  }

  function addMala() {
    setCart((c) => [...c, { kind: "mala", grams, qty: 1, spicy, soup, ingredients: ings }]);
    setIngs([]);
    setPhase("menu");
  }
  function addDrink(d: Drink) {
    setCart((c) => {
      const i = c.findIndex((x) => x.kind === "drink" && x.item_id === d.id);
      if (i < 0) return [...c, { kind: "drink", item_id: d.id, name: d.name, qty: 1 }];
      const next = [...c]; next[i] = { ...next[i], qty: next[i].qty + 1 }; return next;
    });
  }
  function bump(i: number, by: number) {
    setCart((c) => c.flatMap((l, j) => (j !== i ? [l] : l.qty + by <= 0 ? [] : [{ ...l, qty: l.qty + by }])));
  }

  async function placeOrder() {
    setBusy(true); setMsg("");
    const res = await api("/api/delivery/orders", {
      method: "POST",
      body: JSON.stringify({
        zone_id: zoneId, address: address.trim(), phone: phone.trim(),
        lat: pin?.lat, lng: pin?.lng, rider_note: note.trim(),
        pay_method: pay, items: cart,
      }),
    });
    const d = (await res.json()) as { ok: boolean; reason?: string; id?: string };
    setBusy(false);
    if (!d.ok) { setMsg(REASONS[d.reason ?? ""] ?? "สั่งไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
    setCart([]);
    await loadTrack(d.id!);
  }

  async function uploadSlip(file: File) {
    if (!track) return;
    setBusy(true); setMsg("");
    try {
      const [image, ref] = await Promise.all([shrinkImage(file), readSlipRef(file)]);
      const res = await api(`/api/delivery/orders/${track.order.id}/slip`, {
        method: "POST", body: JSON.stringify({ image, mime: "image/jpeg", ref }),
      });
      const d = (await res.json()) as { ok: boolean; reason?: string };
      if (!d.ok) { setMsg(REASONS[d.reason ?? ""] ?? "แนบสลิปไม่สำเร็จ"); return; }
      await loadTrack(track.order.id);
    } catch {
      setMsg("อ่านรูปไม่ได้ ลองถ่ายใหม่");
    } finally { setBusy(false); }
  }

  async function dropPin() {
    if (!navigator.geolocation) { setMsg("เครื่องนี้ปักหมุดไม่ได้"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setPin({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }),
      () => setMsg("ขอตำแหน่งไม่สำเร็จ — กรอกที่อยู่ให้ละเอียดแทนได้"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const count = cart.reduce((n, l) => n + l.qty, 0);

  // ═════════════════ หน้าจอ ═════════════════

  if (phase === "loading") {
    return <div className="screen"><div className="grow center"><p className="hint">กำลังเปิด…</p></div></div>;
  }

  if (phase === "error") {
    return (
      <div className="screen">
        <div className="grow center" style={{ gap: 10 }}>
          <p className="big">เปิดหน้าไม่ได้</p>
          <p className="hint">{msg}</p>
        </div>
      </div>
    );
  }

  if (phase === "consent") {
    return (
      <div className="screen">
        <div className="grow center" style={{ gap: 14, textAlign: "center" }}>
          <p className="big">สั่งเดลิเวอรี่ 🌶️</p>
          <p className="hint">
            สั่งหมาล่าส่งถึงบ้าน พนักงานร้านเป็นคนไปส่งเอง
          </p>
          <p className="hint" style={{ fontSize: 13 }}>
            เราเก็บชื่อและรูปโปรไฟล์ LINE ของคุณ และเก็บ<b>ที่อยู่กับเบอร์โทรเฉพาะที่ใช้ส่งออเดอร์</b>
            เพื่อให้คนขับติดต่อและหาบ้านเจอ ไม่ส่งต่อให้ใคร
          </p>
        </div>
        <button className="btn" onClick={consent} disabled={busy}>
          {busy ? "กำลังบันทึก…" : "ยินยอมและเริ่มสั่ง"}
        </button>
      </div>
    );
  }

  if (phase === "closed") {
    return (
      <div className="screen">
        <div className="topbar"><h1>สั่งเดลิเวอรี่</h1></div>
        <div className="grow center" style={{ gap: 10 }}>
          <p className="big">ตอนนี้ปิดรับออเดอร์</p>
          <p className="hint">กลับมาลองใหม่อีกครั้งนะ · ร้านเปิด 11:00–22:00 น.</p>
        </div>
        <a className="btn ghost" href="/card" style={{ textDecoration: "none" }}>ดูบัตรสะสมของฉัน</a>
      </div>
    );
  }

  // ───── ติดตามสถานะ ─────
  if (phase === "track" && track) {
    const o = track.order;
    const reached = ["placed", "cooking", "out", "delivered"].indexOf(
      o.status === "accepted" ? "placed" : o.status);
    const times = [o.created_at, o.cooking_at, o.out_at, o.delivered_at];

    return (
      <div className="screen">
        <div className="topbar">
          <div>
            <h1>ออเดอร์ {o.order_no}</h1>
            <div className="who">{o.zone} · {baht(o.grand_total)} ฿</div>
          </div>
        </div>

        {msg && <p className="err" style={{ marginBottom: 10 }}>{msg}</p>}

        <div className="stack" style={{ gap: 14, overflowY: "auto" }}>
          {o.status === "cancelled" ? (
            <div className="card" style={{ padding: 16, textAlign: "center" }}>
              <p className="big" style={{ color: "var(--stamp)" }}>ออเดอร์ถูกยกเลิก</p>
              <p className="hint">{o.cancel_reason ?? "ติดต่อร้านได้เลยถ้าสงสัย"}</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 16 }}>
              {STEPS.map((s, i) => (
                <div key={s.key} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: "50%", flex: "0 0 auto",
                      background: i <= reached ? (i === reached ? "var(--brand)" : "var(--ok)") : "transparent",
                      border: i <= reached ? "none" : "2px solid var(--line)",
                      boxShadow: i === reached ? "0 0 0 4px #D9ECF7" : undefined,
                    }} />
                    {i < STEPS.length - 1 && (
                      <span style={{ width: 2, flex: 1, minHeight: 24,
                                     background: i < reached ? "var(--ok)" : "var(--line)" }} />
                    )}
                  </div>
                  <div style={{ paddingBottom: 14 }}>
                    <div style={{ fontSize: 14.5, fontWeight: i <= reached ? 600 : 500,
                                  color: i <= reached ? "var(--ink)" : "var(--muted)" }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {i <= reached ? hhmm(times[i]) : i === reached + 1 ? `ประมาณ ${track.eta_min}–${track.eta_max} นาที` : ""}
                      {s.key === "out" && o.rider && i <= reached ? ` · ${o.rider} เป็นคนส่ง` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {o.pay_method === "transfer" && !o.paid && o.status !== "cancelled" && (
            <div className="card" style={{ padding: 16, textAlign: "center" }}>
              <b style={{ fontSize: 15 }}>โอนพร้อมเพย์ {baht(o.grand_total)} ฿</b>
              <p className="hint" style={{ fontSize: 12.5, margin: "4px 0 10px" }}>
                QR ล็อคยอดแล้ว โอนตามจำนวนนี้ได้เลย
              </p>
              {qrPng && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrPng} alt="QR พร้อมเพย์" style={{ width: 200, maxWidth: "100%", borderRadius: 10 }} />
              )}
              <label className="btn ghost small" style={{ marginTop: 10, display: "block", cursor: "pointer" }}>
                {o.has_slip ? "ส่งสลิปใหม่" : "แนบสลิปโอนเงิน"}
                <input type="file" accept="image/*" hidden disabled={busy}
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSlip(f); e.target.value = ""; }} />
              </label>
              {o.has_slip && (
                <p className="hint" style={{ fontSize: 12, marginTop: 8 }}>
                  แนบสลิปแล้ว รอพนักงานตรวจสักครู่
                </p>
              )}
              {busy && <p className="hint" style={{ fontSize: 12 }}>กำลังส่งรูป…</p>}
            </div>
          )}

          <div className="card" style={{ padding: 14 }}>
            <div className="rows">
              {o.items.map((it, i) => (
                <div className="row" key={i}>
                  <span>{it.name} × {it.qty}</span><b>{baht(it.total)} ฿</b>
                </div>
              ))}
              <div className="row"><span>ค่าส่ง</span><b>{baht(o.delivery_fee)} ฿</b></div>
              {o.discount > 0 && (
                <div className="row"><span>ส่วนลด</span><b style={{ color: "var(--ok)" }}>−{baht(o.discount)} ฿</b></div>
              )}
              <div className="row"><span><b>รวม</b></span><b>{baht(o.grand_total)} ฿</b></div>
            </div>
          </div>

          {o.status === "delivered" && (
            <div className="card" style={{ padding: 14, background: "var(--ok-bg)", borderColor: "#CDE3CB" }}>
              <b style={{ color: "var(--ok)" }}>ได้สแตมป์ 1 ดวงจากออเดอร์นี้แล้ว</b>
            </div>
          )}
        </div>

        <div className="grow" />
        <div className="stack" style={{ gap: 8 }}>
          {track.shop_phone && (
            <a className="btn ghost" style={{ textDecoration: "none" }}
               href={`tel:${track.shop_phone.replace(/\D/g, "")}`}>โทรหาร้าน</a>
          )}
          <a className="btn ghost small" href="/card" style={{ textDecoration: "none" }}>ดูบัตรสะสมของฉัน</a>
          {["delivered", "cancelled"].includes(o.status) && (
            <button className="btn" onClick={() => { setTrack(null); setPhase("menu"); }}>สั่งอีกครั้ง</button>
          )}
        </div>
      </div>
    );
  }

  if (!menu) return null;

  // ───── ประกอบหมาล่า ─────
  if (phase === "detail") {
    return (
      <div className="screen">
        <div className="topbar">
          <div>
            <h1>{bowls(grams)} หมาล่า {grams} ก.</h1>
            <div className="who">เลือกวัตถุดิบได้ไม่จำกัดชนิด</div>
          </div>
          <button className="btn ghost small" style={{ width: "auto" }} onClick={() => setPhase("menu")}>ปิด</button>
        </div>

        <div className="stack" style={{ gap: 14, overflowY: "auto" }}>
          <div>
            <p className="hint" style={{ textAlign: "left", marginBottom: 6 }}>วัตถุดิบ</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {menu.ingredients.map((n) => {
                const on = ings.includes(n);
                return (
                  <button key={n} onClick={() => setIngs((a) => on ? a.filter((x) => x !== n) : [...a, n])}
                          style={{
                            padding: "9px 10px", fontSize: 13.5, borderRadius: 9, textAlign: "left",
                            border: `1.5px solid ${on ? "var(--brand)" : "var(--line)"}`,
                            background: on ? "#EAF4FA" : "var(--surface)",
                            color: on ? "var(--brand-d)" : "var(--ink)", fontWeight: on ? 600 : 400,
                          }}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="hint" style={{ textAlign: "left", marginBottom: 6 }}>ระดับความเผ็ด</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {menu.spicy.map((n) => (
                <button key={n} onClick={() => setSpicy(n)} className="chip-pick"
                        data-on={spicy === n}>{n}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="hint" style={{ textAlign: "left", marginBottom: 6 }}>น้ำซุป</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {menu.soups.map((n) => (
                <button key={n} onClick={() => setSoup(n)} className="chip-pick"
                        data-on={soup === n}>{n}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="grow" />
        <button className="btn" onClick={addMala}>
          ใส่ตะกร้า · {baht((grams / 100) * menu.price_per_100g)} ฿
        </button>
      </div>
    );
  }

  // ───── ตะกร้า ─────
  if (phase === "cart") {
    return (
      <div className="screen">
        <div className="topbar">
          <h1>ตะกร้า</h1>
          <button className="btn ghost small" style={{ width: "auto" }} onClick={() => setPhase("menu")}>เพิ่มอีก</button>
        </div>

        <div className="stack" style={{ gap: 10, overflowY: "auto" }}>
          {cart.length === 0 && <p className="hint">ยังไม่ได้เลือกอะไรเลย</p>}
          {cart.map((l, i) => {
            const q = quote?.lines[i];
            return (
              <div className="card" key={i} style={{ padding: 12, display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 15 }}>
                    {l.kind === "mala" ? `${bowls(l.grams)} หมาล่า ${l.grams} ก.` : l.name}
                  </b>
                  {l.kind === "mala" && (
                    <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                      {[l.spicy, l.soup, ...l.ingredients].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {q ? `${baht(q.total)} ฿` : "…"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                  <button className="chip-pick" onClick={() => bump(i, -1)}>−</button>
                  <span className="chip-pick" data-on>{l.qty}</span>
                  <button className="chip-pick" onClick={() => bump(i, +1)}>+</button>
                </div>
              </div>
            );
          })}

          {quote && (
            <div className="card" style={{ padding: 14 }}>
              <div className="rows">
                <div className="row"><span>ค่าอาหาร</span><b>{baht(quote.food_total)} ฿</b></div>
                <div className="row"><span>ค่าส่ง · {quote.zone.name}</span><b>{baht(quote.delivery_fee)} ฿</b></div>
                {quote.discount > 0 && (
                  <div className="row">
                    <span>{quote.discount_info?.name ?? "ส่วนลด"}</span>
                    <b style={{ color: "var(--ok)" }}>−{baht(quote.discount)} ฿</b>
                  </div>
                )}
                <div className="row"><span><b>รวมทั้งหมด</b></span><b style={{ fontSize: 18 }}>{baht(quote.grand_total)} ฿</b></div>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 12, background: "var(--ok-bg)", borderColor: "#CDE3CB" }}>
            <b style={{ color: "var(--ok)", fontSize: 13 }}>ออเดอร์นี้ได้สแตมป์ 1 ดวงเมื่อส่งถึง</b>
          </div>
        </div>

        <div className="grow" />
        <button className="btn" disabled={!cart.length} onClick={() => setPhase("address")}>
          ถัดไป · ที่อยู่จัดส่ง
        </button>
      </div>
    );
  }

  // ───── ที่อยู่ ─────
  if (phase === "address") {
    return (
      <div className="screen">
        <div className="topbar">
          <h1>ที่อยู่จัดส่ง</h1>
          <button className="btn ghost small" style={{ width: "auto" }} onClick={() => setPhase("cart")}>กลับ</button>
        </div>
        {msg && <p className="err" style={{ marginBottom: 10 }}>{msg}</p>}

        <div className="stack" style={{ gap: 14, overflowY: "auto" }}>
          <div>
            <p className="hint" style={{ textAlign: "left", marginBottom: 6 }}>โซนจัดส่ง</p>
            <div className="stack" style={{ gap: 8 }}>
              {menu.zones.map((z) => (
                <button key={z.id} onClick={() => setZoneId(z.id)} className="card"
                        style={{
                          padding: "11px 13px", display: "flex", justifyContent: "space-between",
                          alignItems: "center", gap: 10, textAlign: "left",
                          border: `1.5px solid ${zoneId === z.id ? "var(--brand)" : "var(--line)"}`,
                          background: zoneId === z.id ? "#F3F9FC" : "var(--surface)",
                        }}>
                  <span>
                    <b style={{ fontSize: 14.5 }}>{z.name}</b>
                    {z.note && <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{z.note}</span>}
                  </span>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{baht(z.fee)} ฿</b>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="ad">ที่อยู่</label>
            <textarea id="ad" className="input-text" rows={3} value={address}
                      placeholder="บ้านเลขที่ ซอย จุดสังเกต"
                      onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div className="form-group">
            <label htmlFor="ph">เบอร์โทร</label>
            <input id="ph" className="input-text" inputMode="tel" value={phone}
                   placeholder="08X-XXX-XXXX" onChange={(e) => setPhone(e.target.value)} />
          </div>

          <button className="btn ghost small" onClick={dropPin}>
            {pin ? "ปักหมุดแล้ว · แตะเพื่อปักใหม่" : "ปักหมุดตำแหน่ง (ช่วยให้คนขับหาเจอ)"}
          </button>

          <div className="form-group">
            <label htmlFor="rn">ฝากบอกคนขับ</label>
            <input id="rn" className="input-text" value={note}
                   placeholder="เช่น โทรก่อนถึง 5 นาที" onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="grow" />
        <button className="btn" disabled={!address.trim() || !phone.trim()}
                onClick={() => { setMsg(""); setPhase("confirm"); }}>
          ถัดไป · ยืนยันออเดอร์
        </button>
      </div>
    );
  }

  // ───── ยืนยัน ─────
  if (phase === "confirm") {
    return (
      <div className="screen">
        <div className="topbar">
          <h1>ยืนยันออเดอร์</h1>
          <button className="btn ghost small" style={{ width: "auto" }} onClick={() => setPhase("address")}>กลับ</button>
        </div>
        {msg && <p className="err" style={{ marginBottom: 10 }}>{msg}</p>}

        <div className="stack" style={{ gap: 14, overflowY: "auto" }}>
          {quote && (
            <div className="card" style={{ padding: 14 }}>
              <div className="rows">
                {quote.lines.map((l, i) => (
                  <div className="row" key={i}><span>{l.name} × {l.qty}</span><b>{baht(l.total)} ฿</b></div>
                ))}
                <div className="row"><span>ค่าส่ง · {quote.zone.name}</span><b>{baht(quote.delivery_fee)} ฿</b></div>
                {quote.discount > 0 && (
                  <div className="row">
                    <span>{quote.discount_info?.name ?? "ส่วนลด"}</span>
                    <b style={{ color: "var(--ok)" }}>−{baht(quote.discount)} ฿</b>
                  </div>
                )}
                <div className="row"><span><b>ยอดชำระ</b></span><b style={{ fontSize: 19 }}>{baht(quote.grand_total)} ฿</b></div>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>ส่งที่</div>
            <b style={{ fontSize: 14 }}>{address}</b>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{phone}{pin ? " · ปักหมุดแล้ว" : ""}</div>
          </div>

          <div>
            <p className="hint" style={{ textAlign: "left", marginBottom: 6 }}>วิธีชำระเงิน</p>
            <div className="stack" style={{ gap: 8 }}>
              {([["cod", "เงินสดปลายทาง", "จ่ายตอนรับของ"],
                 ["transfer", "โอนพร้อมเพย์", "โอนแล้วแนบสลิปในหน้าถัดไป"]] as const).map(([k, t, sub]) => {
                // ลูกค้าที่ยังไม่เคยรับของสำเร็จ เลือกปลายทางไม่ได้ — บอกเหตุผลไว้ด้วย
                // ไม่ใช่ปล่อยให้กดแล้วเด้ง error ทีหลัง
                const locked = k === "cod" && !menu.cod_allowed;
                return (
                  <button key={k} onClick={() => !locked && setPay(k)} disabled={locked}
                          className="card"
                          style={{
                            padding: "11px 13px", textAlign: "left",
                            opacity: locked ? 0.5 : 1,
                            cursor: locked ? "default" : "pointer",
                            border: `1.5px solid ${pay === k ? "var(--brand)" : "var(--line)"}`,
                            background: pay === k ? "#F3F9FC" : "var(--surface)",
                          }}>
                    <b style={{ fontSize: 14.5 }}>{t}</b>
                    <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                      {locked ? "ครั้งแรกยังใช้ไม่ได้" : sub}
                    </span>
                  </button>
                );
              })}
            </div>
            {!menu.cod_allowed && (
              <p className="hint" style={{ textAlign: "left", fontSize: 12.5, marginTop: 8 }}>
                สั่งครั้งแรกโอนก่อนนะ — <b>ส่งถึงแล้วครั้งหน้าจ่ายปลายทางได้เลย</b>
              </p>
            )}
          </div>
        </div>

        <div className="grow" />
        <button className="btn" disabled={busy || !quote} onClick={placeOrder}>
          {busy ? "กำลังส่งออเดอร์…" : `ยืนยันสั่งซื้อ · ${quote ? baht(quote.grand_total) : "…"} ฿`}
        </button>
      </div>
    );
  }

  // ───── หน้าแรก: เลือกน้ำหนัก ─────
  const custom = !menu.presets.some((p) => p.grams === grams);

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>สั่งเดลิเวอรี่ 🌶️</h1>
          <div className="who">ส่งถึงใน {menu.eta.min}–{menu.eta.max} นาที</div>
        </div>
        <a className="btn ghost small" href="/card" style={{ width: "auto", textDecoration: "none" }}>บัตรสะสม</a>
      </div>
      {msg && <p className="err" style={{ marginBottom: 10 }}>{msg}</p>}

      <div className="stack" style={{ gap: 14, overflowY: "auto" }}>
        {menu.active_order && (
          <button className="card" onClick={() => loadTrack(menu.active_order!.id)}
                  style={{ padding: "11px 13px", background: "#EAF4FA", borderColor: "#CDE4F1", textAlign: "left" }}>
            <b style={{ color: "var(--brand-d)", fontSize: 13.5 }}>
              ออเดอร์ {menu.active_order.order_no} กำลังดำเนินการ
            </b>
            <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>แตะเพื่อดูสถานะ</span>
          </button>
        )}

        {menu.discount && (
          <div className="card" style={{ padding: "10px 13px", background: "var(--ok-bg)", borderColor: "#CDE3CB" }}>
            <b style={{ color: "var(--ok)", fontSize: 13.5 }}>
              {menu.discount.name} — ลด {menu.discount.percent}% ค่าอาหารทุกออเดอร์
            </b>
            <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
              {/* ends_at คือ "เที่ยงคืนที่หมดสิทธิ์" วันสุดท้ายที่ใช้ได้จริงคือวันก่อนหน้า
                  ถ้าโชว์ ends_at ตรง ๆ ลูกค้าจะเข้าใจว่าใช้ได้อีกหนึ่งวัน */}
              ใช้ได้ถึง {new Date(new Date(menu.discount.ends_at).getTime() - 1)
                .toLocaleDateString("th-TH", { day: "numeric", month: "long" })}
            </span>
          </div>
        )}

        <div>
          <p className="hint" style={{ textAlign: "left", marginBottom: 6 }}>เลือกน้ำหนัก</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {menu.presets.map((p) => (
              <button key={p.grams} onClick={() => setGrams(p.grams)} className="chip-pick"
                      data-on={grams === p.grams}>
                {bowls(p.grams)} {p.grams} ก. · {baht(p.price)} ฿
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="hint" style={{ textAlign: "left", marginBottom: 6 }}>หรือกำหนดเอง</p>
          <div className="card" style={{
            padding: "11px 13px", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 10,
            border: `1.5px solid ${custom ? "var(--brand)" : "var(--line)"}`,
          }}>
            <button className="chip-pick" disabled={grams - menu.grams_step < menu.min_grams}
                    onClick={() => setGrams((g) => g - menu.grams_step)}>−</button>
            <div style={{ textAlign: "center" }}>
              <b style={{ fontSize: 25, fontVariantNumeric: "tabular-nums" }}>{bowls(grams)} {grams} ก.</b>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                ขั้นต่ำ {menu.min_grams} ก. · เพิ่มทีละ {menu.grams_step} ก.
              </span>
            </div>
            <button className="chip-pick" onClick={() => setGrams((g) => g + menu.grams_step)}>+</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              ขีดละ {menu.price_per_100g} ฿ · {grams / 100} ขีด
            </span>
            <b style={{ fontSize: 19, fontVariantNumeric: "tabular-nums" }}>
              {baht((grams / 100) * menu.price_per_100g)} ฿
            </b>
          </div>
        </div>

        <button className="btn" onClick={() => setPhase("detail")}>เลือกวัตถุดิบ</button>

        <div>
          <p className="hint" style={{ textAlign: "left", marginBottom: 6 }}>เครื่องดื่ม</p>
          <div className="stack" style={{ gap: 8 }}>
            {menu.drinks.map((d) => (
              <div className="card" key={d.id}
                   style={{ padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span>
                  <b style={{ fontSize: 14.5 }}>{d.name}</b>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{baht(d.price)} ฿</span>
                </span>
                <button className="chip-pick" data-on onClick={() => addDrink(d)}>+</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grow" />
      <button className="btn" disabled={!count} onClick={() => setPhase("cart")}>
        {count ? `ดูตะกร้า · ${count} รายการ${quote ? ` · ${baht(quote.grand_total)} ฿` : ""}` : "ยังไม่ได้เลือกอะไร"}
      </button>
    </div>
  );
}

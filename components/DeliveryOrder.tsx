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
 * ธีมแยกจากระบบบัตรสะสมโดยตั้งใจ (ดู order.css) — บัตรสะสมเน้นอ่านง่าย
 * หน้านี้ต้องชวนหิว
 *
 * ริชเมนูมีช่องเดียว หน้าแรกจึงทำสองหน้าที่: มีออเดอร์ค้างก็ขึ้นแถบให้กดดู
 * ไม่มีก็เข้าสั่งของเลย
 *
 * **ราคาทุกบาทมาจากเซิร์ฟเวอร์** หน้านี้ไม่คำนวณเองสักบรรทัด (หลักการข้อ 3)
 */

type Phase =
  | "loading" | "consent" | "closed"
  | "menu" | "detail" | "cart" | "address" | "confirm" | "track" | "error";

interface Preset { grams: number; price: number }
interface Zone { id: string; name: string; note: string | null; fee: number }
interface MenuItem { id: string; name: string; name_en: string | null; price: number; note?: string | null }
interface IngGroup { category: string; items: { name: string; name_en: string | null }[] }
interface Menu {
  ok: boolean; consented: boolean; enabled: boolean; open: boolean;
  cod_allowed: boolean; delivered_count: number; cod_after_orders: number;
  eta: { min: number; max: number };
  price_per_100g: number; min_grams: number; grams_step: number;
  presets: Preset[]; zones: Zone[];
  ingredient_groups: IngGroup[];
  spicy: string[]; soups: string[];
  drinks: MenuItem[]; dishes: MenuItem[];
  discount: { name: string; percent: number; ends_at: string } | null;
  active_order: { id: string; order_no: string; status: string } | null;
}

type Line =
  | { kind: "mala"; grams: number; qty: number; spicy: string; soup: string; ingredients: string[] }
  | { kind: "drink" | "dish"; item_id: string; name: string; qty: number };

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
    created_at: string; cooking_at: string | null; out_at: string | null;
    delivered_at: string | null; cancel_reason: string | null;
    rider: string | null; zone: string; items: QuoteLine[];
  };
  promptpay_id: string | null; shop_phone: string | null;
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
  cod_locked: "ครั้งแรกต้องโอนก่อนนะ ส่งถึงแล้วครั้งหน้าจ่ายปลายทางได้เลย",
  slip_already_used: "สลิปใบนี้ถูกใช้ไปแล้ว ส่งใบที่โอนจริงของออเดอร์นี้นะ",
  image_too_big: "รูปใหญ่เกินไป ลองถ่ายใหม่",
  already_paid: "ออเดอร์นี้ยืนยันการชำระแล้ว",
  item_not_found: "มีรายการที่ร้านเพิ่งปิดไป ลองเลือกใหม่นะ",
};

const STEPS = [
  { key: "placed",    label: "ร้านรับออเดอร์แล้ว" },
  { key: "cooking",   label: "กำลังทำอาหาร" },
  { key: "out",       label: "ออกจากร้านแล้ว" },
  { key: "delivered", label: "ถึงที่หมาย" },
];

const baht = (n: number) => n.toLocaleString("th-TH");
const bowls = (g: number) => (g >= 800 ? "🍲🍲🍲" : g >= 500 ? "🍲🍲" : "🍲");
const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";

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

  const [grams, setGrams] = useState(500);
  const [spicy, setSpicy] = useState("");
  const [soup, setSoup] = useState("");
  const [ings, setIngs] = useState<string[]>([]);
  const [tab, setTab] = useState("");

  const [zoneId, setZoneId] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pay, setPay] = useState<"cod" | "transfer">("cod");

  const loadMenu = useCallback(async () => {
    const res = await api("/api/delivery/menu");
    const d = (await res.json()) as Menu;
    if (!d.ok) {
      setMsg(REASONS[(d as unknown as { reason: string }).reason] ?? "เปิดหน้าไม่ได้");
      setPhase("error"); return null;
    }
    setMenu(d);
    if (!d.zones.length) { setMsg("ยังไม่ได้ตั้งโซนจัดส่ง"); setPhase("error"); return d; }
    setZoneId((z) => z || d.zones[0].id);
    setGrams((g) => (d.presets.length ? d.presets[Math.min(1, d.presets.length - 1)].grams : g));
    setSpicy((s) => s || d.spicy[0] || "");
    setSoup((s) => s || d.soups[0] || "");
    setTab((t) => t || d.ingredient_groups[0]?.category || "");
    if (!d.cod_allowed) setPay("transfer");
    return d;
  }, []);

  const loadTrack = useCallback(async (id: string) => {
    const res = await api(`/api/delivery/orders/${id}`);
    if (!res.ok) return;
    setTrack((await res.json()) as Track);
    setPhase("track");
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await initLiff(process.env.NEXT_PUBLIC_LIFF_ID_ORDER);
        const d = await loadMenu();
        if (!d) return;
        if (!d.consented) { setPhase("consent"); return; }
        if (deepOrder) { await loadTrack(deepOrder); return; }
        if (d.active_order) { await loadTrack(d.active_order.id); return; }
        setPhase(d.enabled && d.open ? "menu" : "closed");
      } catch {
        setMsg("เปิดหน้าไม่ได้ ลองใหม่อีกครั้ง"); setPhase("error");
      }
    })();
  }, [deepOrder, loadMenu, loadTrack]);

  // อัปเดตสถานะสด ๆ ระหว่างเปิดค้างไว้ — ไม่ต้อง push ให้เปลืองโควตาข้อความ
  useEffect(() => {
    if (phase !== "track" || !track) return;
    if (["delivered", "cancelled"].includes(track.order.status)) return;
    const t = setInterval(() => loadTrack(track.order.id), 15000);
    return () => clearInterval(t);
  }, [phase, track, loadTrack]);

  useEffect(() => {
    if (!track?.promptpay_id) { setQrPng(undefined); return; }
    QRCode.toDataURL(promptPayPayload(track.promptpay_id, track.order.grand_total), {
      margin: 1, width: 560, color: { dark: "#2A1F1C", light: "#FFFFFF" },
    }).then(setQrPng).catch(() => setQrPng(undefined));
  }, [track]);

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
  function addItem(kind: "drink" | "dish", m: MenuItem) {
    setCart((c) => {
      const i = c.findIndex((x) => x.kind === kind && x.item_id === m.id);
      if (i < 0) return [...c, { kind, item_id: m.id, name: m.name, qty: 1 }];
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
    } catch { setMsg("อ่านรูปไม่ได้ ลองถ่ายใหม่"); }
    finally { setBusy(false); }
  }

  function dropPin() {
    if (!navigator.geolocation) { setMsg("เครื่องนี้ปักหมุดไม่ได้"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setPin({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }); setMsg(""); },
      () => setMsg("ขอตำแหน่งไม่สำเร็จ — กรอกที่อยู่ให้ละเอียดแทนได้"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const count = cart.reduce((n, l) => n + l.qty, 0);
  const shell = (inner: React.ReactNode) => <div className="ord">{inner}</div>;

  // ══════════════════ หน้าจอ ══════════════════

  if (phase === "loading") {
    return shell(<div className="ord-center"><p>กำลังเปิดร้าน…</p></div>);
  }

  if (phase === "error") {
    return shell(
      <div className="ord-center">
        <p className="big">เปิดหน้าไม่ได้</p>
        <p>{msg}</p>
      </div>);
  }

  if (phase === "consent") {
    return shell(<>
      <div className="ord-center">
        <p className="big">หมาล่าส่งถึงบ้าน 🌶️</p>
        <p>
          เลือกน้ำหนักและวัตถุดิบเองได้ทุกอย่าง<br />พนักงานร้านเป็นคนขับไปส่งเอง
        </p>
        <p style={{ fontSize: 13 }}>
          เราเก็บชื่อและรูปโปรไฟล์ LINE ของคุณ และเก็บ<b>ที่อยู่กับเบอร์โทรเฉพาะที่ใช้ส่งออเดอร์</b>
          เพื่อให้คนขับติดต่อและหาบ้านเจอ ไม่ส่งต่อให้ใคร
        </p>
      </div>
      <div className="ord-foot">
        <button className="ord-btn" onClick={consent} disabled={busy}>
          {busy ? "กำลังบันทึก…" : "ยินยอมและเริ่มสั่ง"}
        </button>
      </div>
    </>);
  }

  if (phase === "closed") {
    return shell(<>
      <div className="ord-top"><h1>สั่งเดลิเวอรี่</h1></div>
      <div className="ord-center">
        <p className="big">ตอนนี้ปิดรับออเดอร์</p>
        <p>กลับมาลองใหม่อีกครั้งนะ · ร้านเปิด 11:00–22:00 น.</p>
      </div>
      <div className="ord-foot">
        <a className="ord-btn ghost" href="/card" style={{ textDecoration: "none" }}>ดูบัตรสะสมของฉัน</a>
      </div>
    </>);
  }

  // ───── ติดตามสถานะ ─────
  if (phase === "track" && track) {
    const o = track.order;
    const reached = ["placed", "cooking", "out", "delivered"]
      .indexOf(o.status === "accepted" ? "placed" : o.status);
    const times = [o.created_at, o.cooking_at, o.out_at, o.delivered_at];

    return shell(<>
      <div className="ord-top">
        <div className="ord-head-row">
          <div>
            <h1>ออเดอร์ {o.order_no}</h1>
            <div className="sub">{o.zone} · {baht(o.grand_total)} ฿</div>
          </div>
        </div>
        {o.status !== "cancelled" && o.status !== "delivered" && (
          <div className="ord-pill"><i />ถึงประมาณอีก {track.eta_min}–{track.eta_max} นาที</div>
        )}
      </div>

      <div className="ord-body">
        {msg && <div className="ord-err">{msg}</div>}

        {o.status === "cancelled" ? (
          <div className="ord-note warn">
            <b>ออเดอร์ถูกยกเลิก</b>
            {o.cancel_reason ?? "ติดต่อร้านได้เลยถ้าสงสัย"}
          </div>
        ) : (
          <div className="ord-sum" style={{ gap: 0 }}>
            {STEPS.map((s, i) => (
              <div className="ord-step" key={s.key}
                   data-s={i < reached ? "done" : i === reached ? "now" : "wait"}>
                <div className="ord-rail">
                  <span className="ord-dot" />
                  {i < STEPS.length - 1 && <span className="ord-bar" />}
                </div>
                <div className="lb">
                  <b>{s.label}</b>
                  <span>
                    {i <= reached ? hhmm(times[i]) : ""}
                    {s.key === "out" && o.rider && i <= reached ? ` · ${o.rider} เป็นคนส่ง` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {o.pay_method === "transfer" && !o.paid && o.status !== "cancelled" && (
          <div className="ord-sum" style={{ textAlign: "center", gap: 10 }}>
            <b style={{ fontSize: 16 }}>โอนพร้อมเพย์ {baht(o.grand_total)} ฿</b>
            <span style={{ fontSize: 12.5, color: "var(--o-muted)" }}>QR ล็อคยอดแล้ว โอนได้เลย</span>
            {qrPng && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrPng} alt="QR พร้อมเพย์" style={{ width: 210, maxWidth: "100%", margin: "0 auto", borderRadius: 12 }} />
            )}
            <label className="ord-btn sm ghost" style={{ cursor: "pointer" }}>
              {busy ? "กำลังส่งรูป…" : o.has_slip ? "ส่งสลิปใหม่" : "แนบสลิปโอนเงิน"}
              <input type="file" accept="image/*" hidden disabled={busy}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSlip(f); e.target.value = ""; }} />
            </label>
            {o.has_slip && <span style={{ fontSize: 12.5, color: "var(--o-ok)" }}>แนบสลิปแล้ว รอพนักงานตรวจสักครู่</span>}
          </div>
        )}

        <div className="ord-sum">
          {o.items.map((it, i) => (
            <div className="ord-row" key={i}><span>{it.name} × {it.qty}</span><b>{baht(it.total)} ฿</b></div>
          ))}
          <div className="ord-row"><span>ค่าส่ง</span><b>{baht(o.delivery_fee)} ฿</b></div>
          {o.discount > 0 && <div className="ord-row cut"><span>ส่วนลด</span><b>−{baht(o.discount)} ฿</b></div>}
          <div className="ord-row total"><span>รวม</span><b>{baht(o.grand_total)} ฿</b></div>
        </div>

        {o.status === "delivered" && (
          <div className="ord-note"><b>ได้สแตมป์ 1 ดวงแล้ว</b>ขอบคุณที่อุดหนุนนะ แล้วเจอกันใหม่</div>
        )}
      </div>

      <div className="ord-foot">
        {track.shop_phone && (
          <a className="ord-btn ghost" style={{ textDecoration: "none" }}
             href={`tel:${track.shop_phone.replace(/\D/g, "")}`}>โทรหาร้าน</a>
        )}
        {["delivered", "cancelled"].includes(o.status) && (
          <button className="ord-btn" onClick={() => { setTrack(null); setPhase("menu"); }}>สั่งอีกครั้ง</button>
        )}
        <a className="ord-btn quiet" href="/card" style={{ textDecoration: "none" }}>ดูบัตรสะสมของฉัน</a>
      </div>
    </>);
  }

  if (!menu) return null;

  // ───── เลือกวัตถุดิบ ─────
  if (phase === "detail") {
    const group = menu.ingredient_groups.find((g) => g.category === tab);
    const price = (grams / 100) * menu.price_per_100g;

    return shell(<>
      <div className="ord-top">
        <div className="ord-head-row">
          <div>
            <h1>{bowls(grams)} หมาล่า {grams} ก.</h1>
            <div className="sub">เลือกวัตถุดิบได้ไม่จำกัดชนิด · ราคาคิดตามน้ำหนัก</div>
          </div>
          <button className="back" onClick={() => setPhase("menu")}>ย้อน</button>
        </div>
      </div>

      <div className="ord-body">
        <div className="ord-tabs">
          {menu.ingredient_groups.map((g) => {
            const n = g.items.filter((it) => ings.includes(it.name)).length;
            return (
              <button key={g.category} className="ord-tab" data-on={tab === g.category}
                      onClick={() => setTab(g.category)}>
                {g.category}{n > 0 && <span className="n">{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="ord-grid">
          {group?.items.map((it) => {
            const on = ings.includes(it.name);
            return (
              <button key={it.name} className="ord-ing" data-on={on}
                      onClick={() => setIngs((a) => on ? a.filter((x) => x !== it.name) : [...a, it.name])}>
                <b>{it.name}</b>
                {it.name_en && <span>{it.name_en}</span>}
              </button>
            );
          })}
        </div>

        <div className="ord-sec">
          <h2>ระดับความเผ็ด</h2>
          <div className="ord-chips">
            {menu.spicy.map((n) => (
              <button key={n} className="ord-chip" data-on={spicy === n} onClick={() => setSpicy(n)}>{n}</button>
            ))}
          </div>
        </div>

        <div className="ord-sec">
          <h2>น้ำซุป</h2>
          <div className="ord-chips">
            {menu.soups.map((n) => (
              <button key={n} className="ord-chip" data-on={soup === n} onClick={() => setSoup(n)}>{n}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="ord-foot">
        <button className="ord-btn" onClick={addMala}>
          ใส่ตะกร้า <span className="amt">· เลือกแล้ว {ings.length} อย่าง · {baht(price)} ฿</span>
        </button>
      </div>
    </>);
  }

  // ───── ตะกร้า ─────
  if (phase === "cart") {
    return shell(<>
      <div className="ord-top plain">
        <div className="ord-head-row">
          <h1>ตะกร้า</h1>
          <button className="back" onClick={() => setPhase("menu")}>เพิ่มอีก</button>
        </div>
      </div>

      <div className="ord-body">
        {cart.length === 0 && <p style={{ color: "var(--o-muted)" }}>ยังไม่ได้เลือกอะไรเลย</p>}
        {cart.map((l, i) => {
          const q = quote?.lines[i];
          return (
            <div className="ord-item" key={i}>
              <div className="t">
                <b>{l.kind === "mala" ? `${bowls(l.grams)} หมาล่า ${l.grams} ก.` : l.name}</b>
                {l.kind === "mala" && (
                  <div className="opts">{[l.spicy, l.soup, ...l.ingredients].filter(Boolean).join(" · ")}</div>
                )}
                <div className="ord-price" style={{ fontSize: 16, marginTop: 4 }}>{q ? `${baht(q.total)} ฿` : "…"}</div>
              </div>
              <div className="ord-chips" style={{ flexWrap: "nowrap" }}>
                <button className="ord-chip" onClick={() => bump(i, -1)}>−</button>
                <span className="ord-chip" data-on>{l.qty}</span>
                <button className="ord-chip" onClick={() => bump(i, +1)}>+</button>
              </div>
            </div>
          );
        })}

        {quote && (
          <div className="ord-sum">
            <div className="ord-row"><span>ค่าอาหาร</span><b>{baht(quote.food_total)} ฿</b></div>
            <div className="ord-row"><span>ค่าส่ง · {quote.zone.name}</span><b>{baht(quote.delivery_fee)} ฿</b></div>
            {quote.discount > 0 && (
              <div className="ord-row cut">
                <span>{quote.discount_info?.name ?? "ส่วนลด"}</span><b>−{baht(quote.discount)} ฿</b>
              </div>
            )}
            <div className="ord-row total"><span>รวมทั้งหมด</span><b>{baht(quote.grand_total)} ฿</b></div>
          </div>
        )}

        <div className="ord-note">ออเดอร์นี้ได้สแตมป์ 1 ดวงเมื่อส่งถึง</div>
      </div>

      <div className="ord-foot">
        <button className="ord-btn" disabled={!cart.length} onClick={() => setPhase("address")}>
          ถัดไป · ที่อยู่จัดส่ง
        </button>
      </div>
    </>);
  }

  // ───── ที่อยู่ ─────
  if (phase === "address") {
    return shell(<>
      <div className="ord-top plain">
        <div className="ord-head-row">
          <h1>ส่งที่ไหน</h1>
          <button className="back" onClick={() => setPhase("cart")}>ย้อน</button>
        </div>
      </div>

      <div className="ord-body">
        {msg && <div className="ord-err">{msg}</div>}

        <div className="ord-sec">
          <h2>โซนจัดส่ง</h2>
          {menu.zones.map((z) => (
            <button key={z.id} className="ord-pick" data-on={zoneId === z.id} onClick={() => setZoneId(z.id)}>
              <span className="t">
                <b>{z.name}</b>
                {z.note && <span>{z.note}</span>}
              </span>
              <span className="fee">{baht(z.fee)} ฿</span>
            </button>
          ))}
        </div>

        <div className="ord-field">
          <label htmlFor="ad">ที่อยู่</label>
          <textarea id="ad" className="ord-input" rows={3} value={address}
                    placeholder="บ้านเลขที่ ซอย จุดสังเกต"
                    onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div className="ord-field">
          <label htmlFor="ph">เบอร์โทร</label>
          <input id="ph" className="ord-input" inputMode="tel" value={phone}
                 placeholder="08X-XXX-XXXX" onChange={(e) => setPhone(e.target.value)} />
        </div>

        <button className="ord-btn sm ghost" onClick={dropPin}>
          {pin ? "ปักหมุดแล้ว · แตะเพื่อปักใหม่" : "ปักหมุดตำแหน่ง ช่วยให้คนขับหาเจอ"}
        </button>

        <div className="ord-field">
          <label htmlFor="rn">ฝากบอกคนขับ</label>
          <input id="rn" className="ord-input" value={note}
                 placeholder="เช่น โทรก่อนถึง 5 นาที" onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="ord-foot">
        <button className="ord-btn" disabled={!address.trim() || !phone.trim()}
                onClick={() => { setMsg(""); setPhase("confirm"); }}>
          ถัดไป · ยืนยันออเดอร์
        </button>
      </div>
    </>);
  }

  // ───── ยืนยัน ─────
  if (phase === "confirm") {
    return shell(<>
      <div className="ord-top plain">
        <div className="ord-head-row">
          <h1>ยืนยันออเดอร์</h1>
          <button className="back" onClick={() => setPhase("address")}>ย้อน</button>
        </div>
      </div>

      <div className="ord-body">
        {msg && <div className="ord-err">{msg}</div>}

        {quote && (
          <div className="ord-sum">
            {quote.lines.map((l, i) => (
              <div className="ord-row" key={i}><span>{l.name} × {l.qty}</span><b>{baht(l.total)} ฿</b></div>
            ))}
            <div className="ord-row"><span>ค่าส่ง · {quote.zone.name}</span><b>{baht(quote.delivery_fee)} ฿</b></div>
            {quote.discount > 0 && (
              <div className="ord-row cut">
                <span>{quote.discount_info?.name ?? "ส่วนลด"}</span><b>−{baht(quote.discount)} ฿</b>
              </div>
            )}
            <div className="ord-row total"><span>ยอดชำระ</span><b>{baht(quote.grand_total)} ฿</b></div>
          </div>
        )}

        <div className="ord-item">
          <div className="t">
            <span className="en">ส่งที่</span>
            <b style={{ fontSize: 14.5 }}>{address}</b>
            <div className="opts">{phone}{pin ? " · ปักหมุดแล้ว" : ""}</div>
          </div>
        </div>

        <div className="ord-sec">
          <h2>วิธีชำระเงิน</h2>
          {([["cod", "เงินสดปลายทาง", "จ่ายตอนรับของ"],
             ["transfer", "โอนพร้อมเพย์", "โอนแล้วแนบสลิปในหน้าถัดไป"]] as const).map(([k, t, sub]) => {
            const locked = k === "cod" && !menu.cod_allowed;
            return (
              <button key={k} className="ord-pick" data-on={pay === k} disabled={locked}
                      onClick={() => !locked && setPay(k)}>
                <span className="t">
                  <b>{t}</b>
                  <span>{locked ? "ครั้งแรกยังใช้ไม่ได้" : sub}</span>
                </span>
              </button>
            );
          })}
          {!menu.cod_allowed && (
            <div className="ord-note warn">
              สั่งครั้งแรกโอนก่อนนะ — <b style={{ display: "inline" }}>ส่งถึงแล้วครั้งหน้าจ่ายปลายทางได้เลย</b>
            </div>
          )}
        </div>
      </div>

      <div className="ord-foot">
        <button className="ord-btn" disabled={busy || !quote} onClick={placeOrder}>
          {busy ? "กำลังส่งออเดอร์…" : `ยืนยันสั่งซื้อ · ${quote ? baht(quote.grand_total) : "…"} ฿`}
        </button>
      </div>
    </>);
  }

  // ───── หน้าแรก ─────
  const custom = !menu.presets.some((p) => p.grams === grams);

  return shell(<>
    <div className="ord-top">
      <div className="ord-head-row">
        <div>
          <h1>หมาล่า La-Mi 🌶️</h1>
          <div className="sub">เลือกน้ำหนักและวัตถุดิบเองได้</div>
        </div>
        <a className="back" href="/card" style={{ textDecoration: "none" }}>บัตรสะสม</a>
      </div>
      <div className="ord-pill"><i />เปิดรับออเดอร์ · ส่งถึงใน {menu.eta.min}–{menu.eta.max} นาที</div>
    </div>

    <div className="ord-body">
      {msg && <div className="ord-err">{msg}</div>}

      {menu.active_order && (
        <button className="ord-banner" onClick={() => loadTrack(menu.active_order!.id)}>
          <span>
            <b>ออเดอร์ {menu.active_order.order_no} กำลังดำเนินการ</b>
            <span>แตะเพื่อดูสถานะ</span>
          </span>
          <span style={{ fontSize: 20, color: "var(--o-chili)" }}>›</span>
        </button>
      )}

      {menu.discount && (
        <div className="ord-note">
          <b>{menu.discount.name} — ลด {menu.discount.percent}% ค่าอาหารทุกออเดอร์</b>
          ใช้ได้ถึง {new Date(new Date(menu.discount.ends_at).getTime() - 1)
            .toLocaleDateString("th-TH", { day: "numeric", month: "long" })}
        </div>
      )}

      <div className="ord-sec">
        <h2>เลือกน้ำหนักหมาล่า</h2>
        <div className="ord-weights">
          {menu.presets.map((p) => (
            <button key={p.grams} className="ord-weight" data-on={grams === p.grams}
                    onClick={() => setGrams(p.grams)}>
              <span className="emo">{bowls(p.grams)}</span>
              <span className="t">
                <b>{p.grams} กรัม</b>
                <span>{p.grams / 100} ขีด · {p.grams >= 800 ? "3–4 คน" : p.grams >= 500 ? "2 คนแบ่งกัน" : "1 คนอิ่ม"}</span>
              </span>
              <span className="ord-price">{baht(p.price)} ฿</span>
            </button>
          ))}
        </div>

        <div className="ord-stepper" data-on={custom}>
          <button className="ord-round" disabled={grams - menu.grams_step < menu.min_grams}
                  onClick={() => setGrams((g) => g - menu.grams_step)}>−</button>
          <span className="mid">
            <b>{grams} ก.</b>
            <span>ขั้นต่ำ {menu.min_grams} ก. · ทีละ {menu.grams_step} ก.</span>
          </span>
          <button className="ord-round" onClick={() => setGrams((g) => g + menu.grams_step)}>+</button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: "var(--o-muted)" }}>
            ขีดละ {menu.price_per_100g} ฿ · {grams / 100} ขีด
          </span>
          <span className="ord-price" style={{ fontSize: 22 }}>
            {baht((grams / 100) * menu.price_per_100g)} ฿
          </span>
        </div>

        <button className="ord-btn" onClick={() => setPhase("detail")}>เลือกวัตถุดิบ</button>
      </div>

      {menu.dishes.length > 0 && (
        <div className="ord-sec">
          <h2>เมนูพิเศษ</h2>
          {menu.dishes.map((d) => (
            <div className="ord-item ord-dish" key={d.id}>
              <div className="t">
                <b>{d.name}</b>
                {d.name_en && <span className="en">{d.name_en}</span>}
                {d.note && <div className="note">{d.note}</div>}
                <div className="ord-price" style={{ fontSize: 17, marginTop: 4 }}>{baht(d.price)} ฿</div>
              </div>
              <button className="ord-add" onClick={() => addItem("dish", d)} aria-label={`เพิ่ม ${d.name}`}>+</button>
            </div>
          ))}
        </div>
      )}

      <div className="ord-sec">
        <h2>เครื่องดื่ม</h2>
        {menu.drinks.map((d) => (
          <div className="ord-item" key={d.id}>
            <div className="t">
              <b>{d.name}</b>
              {d.name_en && <span className="en">{d.name_en}</span>}
              <div className="ord-price" style={{ fontSize: 16, marginTop: 2 }}>{baht(d.price)} ฿</div>
            </div>
            <button className="ord-add" onClick={() => addItem("drink", d)} aria-label={`เพิ่ม ${d.name}`}>+</button>
          </div>
        ))}
      </div>
    </div>

    <div className="ord-foot">
      <button className="ord-btn" disabled={!count} onClick={() => setPhase("cart")}>
        {count
          ? <>ดูตะกร้า <span className="amt">· {count} รายการ{quote ? ` · ${baht(quote.grand_total)} ฿` : ""}</span></>
          : "เลือกของก่อนนะ"}
      </button>
    </div>
  </>);
}

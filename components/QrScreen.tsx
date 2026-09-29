"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";

/**
 * หน้าโชว์ QR ให้ลูกค้าสแกน — ใช้ทั้งตอนสะสมแต้มและตอนรับรางวัล
 *
 * §4 จุดที่มักออกแบบพลาด: ถ้าจอพนักงานไม่บอกว่าลูกค้าสแกนสำเร็จหรือยัง
 * พนักงานจะไม่กล้าเก็บจอ ต้องยืนถามลูกค้าทุกครั้งจนคิวติด
 * หน้านี้จึงคอยถามสถานะเองแล้วเปลี่ยนเป็นหน้าสำเร็จทันทีที่ลูกค้าสแกน
 *
 * ใช้สถานะเดียว (phase) แทนการเดาจากหลายตัวแปรประกอบกัน
 * เพราะเวอร์ชันแรกคำนวณ "หมดอายุ" จาก left===0 ซึ่งเป็นจริงอยู่ชั่วครู่
 * ตั้งแต่ยังไม่ได้ QR มาด้วยซ้ำ ทำให้หน้าจอแวบเป็น "QR หมดอายุ" ตอนเพิ่งกดออก
 */

type Mode = "stamp" | "reward" | "promo";
type Phase = "loading" | "showing" | "expired" | "done" | "error";

interface Status {
  claimed?: boolean;
  points?: number;
  redeemed?: boolean;
  customer_name?: string | null;
  slot_no?: number | null;
  given?: string | null;
  entitlement_id?: string | null;
}

/**
 * จำนวนดวงของ QR โปรโมชั่น
 *
 * ฝั่งเซิร์ฟเวอร์จำกัดไว้ 1–10 อยู่แล้ว ค่านี้เป็นแค่ค่าที่ปุ่มส่งไป
 * ถ้าจะเปลี่ยนจำนวนถาวร แก้ที่ app_settings.promo_points แล้วอ่านมาแสดงแทน
 */
const PROMO_POINTS = 3;

const CFG = {
  stamp: {
    title: "สะสมแต้ม",
    issue: "/api/staff/tokens",
    status: (c: string) => `/api/staff/tokens/${c}`,
    isDone: (s: Status) => !!s.claimed,
    prompt: "ให้ลูกค้าสแกนด้วยกล้องในแอป LINE",
  },
  promo: {
    title: "โปรโมชั่น",
    issue: "/api/staff/tokens",
    status: (c: string) => `/api/staff/tokens/${c}`,
    isDone: (s: Status) => !!s.claimed,
    prompt: "ให้ลูกค้าสแกนเพื่อรับ 3 ดวงรวด",
  },
  reward: {
    title: "รับรางวัล",
    issue: "/api/staff/redeem-tokens",
    status: (c: string) => `/api/staff/redeem-tokens/${c}`,
    isDone: (s: Status) => !!s.redeemed,
    prompt: "ให้ลูกค้าสแกนเพื่อเลือกรางวัล",
  },
} as const;

export default function QrScreen({ mode }: { mode: Mode }) {
  const cfg = CFG[mode];
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [png, setPng] = useState<string>();
  const [code, setCode] = useState<string>();
  const [left, setLeft] = useState(0);
  const [result, setResult] = useState<Status | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const deadline = useRef(0);

  const issue = useCallback(async () => {
    setPhase("loading");
    setPng(undefined);
    setCode(undefined);
    setResult(null);
    deadline.current = 0;

    try {
      const res = await fetch(cfg.issue, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "promo" ? { points: PROMO_POINTS } : {}),
      });
      if (!res.ok) { setPhase("error"); return; }
      const d = (await res.json()) as { code: string; url: string; expires_at: string };

      // วาด QR ให้เสร็จก่อน แล้วค่อยเปลี่ยนสถานะพร้อมกันทีเดียว
      // ถ้าตั้งเวลาหมดอายุก่อนวาดเสร็จ จะมีช่วงที่หน้าจอไม่รู้ว่าจะแสดงอะไร
      const img = await QRCode.toDataURL(d.url, {
        margin: 1, width: 640, color: { dark: "#23404F", light: "#FFFFFF" },
      });

      const ms = new Date(d.expires_at).getTime();
      deadline.current = ms;
      setCode(d.code);
      setPng(img);
      setLeft(Math.max(0, Math.round((ms - Date.now()) / 1000)));
      setPhase("showing");
    } catch {
      setPhase("error");
    }
  }, [cfg.issue, mode]);

  // Layout อาจถูกเก็บใน App Router cache ได้ แต่ QR ต้องห้ามออกก่อน API
  // ยืนยัน session ที่ runtime ของ Worker ก่อนทุกครั้ง
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/staff/session", { cache: "no-store" });
        if (!res.ok) {
          window.location.replace(`/staff/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        if (active) setSessionChecked(true);
      } catch {
        if (active) setPhase("error");
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (sessionChecked) issue();
  }, [sessionChecked, issue]);

  // ถามสถานะทุก 2 วินาที — พอที่สเกลนี้ ไม่ต้องใช้ websocket
  useEffect(() => {
    if (phase !== "showing" || !code) return;
    const t = setInterval(async () => {
      const res = await fetch(cfg.status(code));
      if (!res.ok) return;
      const s = (await res.json()) as Status;
      if (cfg.isDone(s)) { setResult(s); setPhase("done"); }
    }, 2000);
    return () => clearInterval(t);
  }, [phase, code, cfg]);

  // นับถอยหลัง — คำนวณทันทีหนึ่งครั้งก่อนตั้งช่วงเวลา ไม่รอครบรอบแรก
  useEffect(() => {
    if (phase !== "showing") return;
    const tick = () => {
      const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setPhase("expired");
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [phase]);

  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const close = (
    <button className="btn ghost small" style={{ width: "auto" }}
            onClick={() => router.replace("/staff")}>ปิด</button>
  );

  if (phase === "done" && result) {
    return (
      <div className="screen">
        <div className="topbar"><h1>{cfg.title}</h1></div>
        <div className="grow center">
          <div className="card done" style={{ width: "100%" }}>
            <div className="tick" aria-hidden>✓</div>
            {mode === "promo" ? (
              <>
                <p className="big">ได้ {PROMO_POINTS} ดวง</p>
                <p className="hint">
                  {result.customer_name ?? "ลูกค้า"} · ล่าสุดดวงที่ {result.slot_no}
                </p>
              </>
            ) : mode === "stamp" ? (
              <>
                <p className="big">ได้ดวงที่ {result.slot_no}</p>
                <p className="hint">{result.customer_name ?? "ลูกค้า"}</p>
              </>
            ) : (
              <>
                <p className="big">{result.given}</p>
                <p className="hint">ให้กับ {result.customer_name ?? "ลูกค้า"}</p>
              </>
            )}
          </div>
        </div>
        <div className="stack">
          <button className="btn" onClick={issue}>ลูกค้าคนถัดไป</button>
          {mode === "reward" && result.entitlement_id && (
            <UndoButton entitlementId={result.entitlement_id} />
          )}
          <button className="btn ghost small" onClick={() => router.replace("/staff")}>
            กลับหน้าหลัก
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar"><h1>{cfg.title}</h1>{close}</div>

      <div className="grow center" style={{ gap: 18 }}>
        {phase === "loading" && <p className="hint">กำลังออก QR…</p>}

        {phase === "error" && (
          <>
            <p className="err">ออก QR ไม่สำเร็จ</p>
            <p className="hint">ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่</p>
          </>
        )}

        {phase === "expired" && (
          <>
            <p className="big">QR หมดอายุแล้ว</p>
            <p className="hint">กดออกใบใหม่ได้เลย ใบเก่าใช้ไม่ได้แล้ว</p>
          </>
        )}

        {phase === "showing" && png && (
          <>
            {mode === "promo" && (
              <p className="hint" style={{ color: "var(--stamp)", fontWeight: 600 }}>
                ⚠ ใบนี้ให้ {PROMO_POINTS} ดวง — ออกเมื่อลูกค้าทำเงื่อนไขครบแล้วเท่านั้น
              </p>
            )}
            <p className="hint">{cfg.prompt}</p>
            <div className="qr-wrap"><img src={png} alt="QR สำหรับให้ลูกค้าสแกน" /></div>
            <p className="countdown">หมดอายุใน {mmss}</p>
          </>
        )}
      </div>

      <button className="btn" onClick={issue} disabled={phase === "loading"}>
        {phase === "loading" ? "กำลังออก QR…"
          : phase === "showing" ? "ออกใบใหม่"
          : "ออก QR ใบใหม่"}
      </button>
    </div>
  );
}

/** คืนสิทธิ์เมื่อลูกค้ากดพลาด — ได้ภายใน 10 นาที (§4) */
function UndoButton({ entitlementId }: { entitlementId: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  if (state === "done") return <p className="hint">คืนสิทธิ์ให้ลูกค้าแล้ว</p>;
  return (
    <button
      className="btn ghost small"
      onClick={async () => {
        const res = await fetch(`/api/staff/redemptions/${entitlementId}/void`, { method: "POST" });
        setState(res.ok ? "done" : "fail");
      }}
    >
      {state === "fail" ? "คืนสิทธิ์ไม่ได้แล้ว (เกิน 10 นาที)" : "ลูกค้ากดพลาด — คืนสิทธิ์"}
    </button>
  );
}

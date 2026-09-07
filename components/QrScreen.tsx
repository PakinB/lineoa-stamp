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
 */

type Mode = "stamp" | "reward";

interface Status {
  claimed?: boolean;
  expired?: boolean;
  redeemed?: boolean;
  customer_name?: string | null;
  slot_no?: number | null;
  given?: string | null;
  entitlement_id?: string | null;
}

const CFG = {
  stamp: {
    title: "สะสมแต้ม",
    issue: "/api/staff/tokens",
    status: (c: string) => `/api/staff/tokens/${c}`,
    isDone: (s: Status) => !!s.claimed,
  },
  reward: {
    title: "รับรางวัล",
    issue: "/api/staff/redeem-tokens",
    status: (c: string) => `/api/staff/redeem-tokens/${c}`,
    isDone: (s: Status) => !!s.redeemed,
  },
} as const;

export default function QrScreen({ mode }: { mode: Mode }) {
  const cfg = CFG[mode];
  const router = useRouter();

  const [png, setPng] = useState<string>();
  const [code, setCode] = useState<string>();
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [left, setLeft] = useState(0);
  const [done, setDone] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const issue = useCallback(async () => {
    setErr(""); setDone(null); setPng(undefined);
    const res = await fetch(cfg.issue, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) { setErr("ออก QR ไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
    const d = (await res.json()) as { code: string; url: string; expires_at: string };
    setCode(d.code);
    setExpiresAt(new Date(d.expires_at).getTime());
    // วาด QR ฝั่งเบราว์เซอร์ — ฝั่งเซิร์ฟเวอร์ทำไม่ได้บน edge runtime
    setPng(await QRCode.toDataURL(d.url, { margin: 1, width: 640,
      color: { dark: "#231A17", light: "#FFFFFF" } }));
  }, [cfg.issue]);

  useEffect(() => { issue(); }, [issue]);

  // ถามสถานะทุก 2 วินาที — พอที่สเกลนี้ ไม่ต้องใช้ websocket
  useEffect(() => {
    if (!code || done) return;
    timer.current = setInterval(async () => {
      const res = await fetch(cfg.status(code));
      if (!res.ok) return;
      const s = (await res.json()) as Status;
      if (cfg.isDone(s)) setDone(s);
    }, 2000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [code, done, cfg]);

  // นับถอยหลัง
  useEffect(() => {
    if (!expiresAt || done) return;
    const t = setInterval(() => {
      setLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    }, 500);
    return () => clearInterval(t);
  }, [expiresAt, done]);

  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  // ---------- สแกนสำเร็จแล้ว ----------
  if (done) {
    return (
      <div className="screen">
        <div className="topbar"><h1>{cfg.title}</h1></div>
        <div className="grow center">
          <div className="card done" style={{ width: "100%" }}>
            <div className="tick" aria-hidden>✓</div>
            {mode === "stamp" ? (
              <>
                <p className="big">ได้ดวงที่ {done.slot_no}</p>
                <p className="hint">{done.customer_name ?? "ลูกค้า"}</p>
              </>
            ) : (
              <>
                <p className="big">{done.given}</p>
                <p className="hint">ให้กับ {done.customer_name ?? "ลูกค้า"}</p>
              </>
            )}
          </div>
        </div>

        <div className="stack">
          <button className="btn" onClick={issue}>ลูกค้าคนถัดไป</button>
          {mode === "reward" && done.entitlement_id && (
            <UndoButton entitlementId={done.entitlement_id} />
          )}
          <button className="btn ghost small" onClick={() => router.replace("/staff")}>
            กลับหน้าหลัก
          </button>
        </div>
      </div>
    );
  }

  // ---------- กำลังโชว์ QR ----------
  const expired = left === 0 && expiresAt > 0;
  return (
    <div className="screen">
      <div className="topbar">
        <h1>{cfg.title}</h1>
        <button className="btn ghost small" style={{ width: "auto" }}
                onClick={() => router.replace("/staff")}>ปิด</button>
      </div>

      <div className="grow center" style={{ gap: 18 }}>
        {err && <p className="err">{err}</p>}

        {expired ? (
          <>
            <p className="big">QR หมดอายุแล้ว</p>
            <p className="hint">กดออกใบใหม่ได้เลย ใบเก่าใช้ไม่ได้แล้ว</p>
          </>
        ) : png ? (
          <>
            <p className="hint">
              {mode === "stamp"
                ? "ให้ลูกค้าสแกนด้วยกล้องในแอป LINE"
                : "ให้ลูกค้าสแกนเพื่อเลือกรางวัล"}
            </p>
            <div className="qr-wrap"><img src={png} alt="QR สำหรับให้ลูกค้าสแกน" /></div>
            <p className="countdown">หมดอายุใน {mmss}</p>
          </>
        ) : (
          <p className="hint">กำลังออก QR…</p>
        )}
      </div>

      <button className="btn" onClick={issue}>
        {expired ? "ออก QR ใบใหม่" : "ออกใบใหม่"}
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

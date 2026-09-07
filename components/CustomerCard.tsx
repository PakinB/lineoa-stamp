"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import StampCard from "@/components/StampCard";
import type { CardState, RedeemableListResponse } from "@/lib/api-types";

/**
 * หน้าจอลูกค้าทั้งหมดอยู่ในคอมโพเนนต์เดียว
 * เพราะ LIFF ตั้ง Endpoint URL ได้อันเดียว จึงต้องแยกงานจาก query string เอา
 */

type Phase = "loading" | "consent" | "card" | "celebrate" | "picker" | "redeemed" | "error";

interface CardResponse extends CardState { ok: boolean; consented: boolean }

/** ข้อความผิดพลาดต้องบอกลูกค้าว่าทำอะไรต่อ ไม่ใช่แค่บอกว่าพัง */
const REASONS: Record<string, string> = {
  invalid_or_used: "QR นี้ถูกใช้ไปแล้ว ขอ QR ใบใหม่จากพนักงานได้เลย",
  already_claimed_by_you: "คุณสแกนใบนี้ไปแล้ว ดวงถูกเพิ่มให้เรียบร้อย",
  rate_limited: "วันนี้สะสมครบตามที่กำหนดแล้ว พรุ่งนี้สะสมต่อได้",
  invalid_or_expired: "QR หมดอายุแล้ว ขอให้พนักงานกดออกใบใหม่",
  entitlement_not_available: "สิทธิ์นี้ถูกใช้ไปแล้ว",
  unauthenticated: "กรุณาเปิดหน้านี้จากแอป LINE",
};

/** เผื่อไว้ให้ต่อ LIFF ทีหลัง — ตอนนี้ยังไม่มี token ก็ยิงเปล่า ๆ ได้ */
async function api(url: string, init?: RequestInit) {
  const liff = (globalThis as { liff?: { getAccessToken?: () => string | null } }).liff;
  const token = liff?.getAccessToken?.();
  return fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function CustomerCard() {
  const params = useSearchParams();
  const stampCode = params.get("t");
  const redeemCode = params.get("r");

  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<CardState | null>(null);
  const [justSlot, setJustSlot] = useState<number | null>(null);
  const [won, setWon] = useState<string[]>([]);
  const [picker, setPicker] = useState<RedeemableListResponse | null>(null);
  const [given, setGiven] = useState<string>("");
  const [msg, setMsg] = useState("");
  const started = useRef(false);

  // ---------- ทำงานตามสิ่งที่ติดมากับลิงก์ ----------
  const run = useCallback(async () => {
    if (stampCode) {
      const res = await api("/api/stamps/claim", {
        method: "POST", body: JSON.stringify({ code: stampCode }),
      });
      const d = await res.json();
      if (d.ok) {
        setState(d.card);
        setJustSlot(d.stamped_slot ?? null);
        const labels = (d.new_entitlements ?? []).map((e: { label: string }) => e.label);
        setWon(labels);
        setPhase(labels.length > 0 ? "celebrate" : "card");
      } else {
        setMsg(REASONS[d.reason] ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
        if (d.card) { setState(d.card); setPhase("card"); } else setPhase("error");
      }
      return;
    }

    if (redeemCode) {
      const res = await api(`/api/redeem/${redeemCode}`);
      const d = (await res.json()) as RedeemableListResponse;
      if (d.ok) {
        if (d.entitlements.length === 0) {
          setMsg("ตอนนี้ยังไม่มีสิทธิ์ที่ใช้ได้ สะสมให้ครบก่อนนะครับ");
          setPhase("error");
        } else { setPicker(d); setPhase("picker"); }
      } else {
        setMsg(REASONS[d.reason] ?? "QR ใช้ไม่ได้แล้ว");
        setPhase("error");
      }
      return;
    }

    setPhase("card");
  }, [stampCode, redeemCode]);

  // ---------- โหลดครั้งแรก: เช็คความยินยอมก่อนทำอย่างอื่น (§13) ----------
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const res = await api("/api/me/card");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setMsg(REASONS[d.reason] ?? "เข้าใช้งานไม่ได้");
        setPhase("error");
        return;
      }
      const d = (await res.json()) as CardResponse;
      setState({ card: d.card, entitlements: d.entitlements, next_checkpoint: d.next_checkpoint });
      if (!d.consented) { setPhase("consent"); return; }
      run();
    })();
  }, [run]);

  async function accept() {
    setPhase("loading");
    await api("/api/me/consent", { method: "POST" });
    run();
  }

  async function pick(entitlementId: string, optionId?: string) {
    setPhase("loading");
    const res = await api(`/api/redeem/${redeemCode}`, {
      method: "POST",
      body: JSON.stringify({ entitlement_id: entitlementId, option_id: optionId }),
    });
    const d = await res.json();
    if (d.ok) { setGiven(d.given); setState(d.card); setPhase("redeemed"); }
    else { setMsg(REASONS[d.reason] ?? "ใช้สิทธิ์ไม่สำเร็จ"); setPhase("error"); }
  }

  // ═══════════════ หน้าจอ ═══════════════

  if (phase === "loading") {
    return <div className="screen center"><p className="hint">กำลังโหลด…</p></div>;
  }

  if (phase === "consent") {
    return (
      <div className="screen">
        <div className="grow center" style={{ gap: 16 }}>
          <p className="big">ยินดีต้อนรับ 🌶️</p>
          <p className="hint">
            บัตรสะสมของร้าน — กินครบ 10 ครั้งได้ของรางวัล<br />สะสมและใช้ได้ทุกสาขา
          </p>
          <p className="hint" style={{ fontSize: 13 }}>
            เราเก็บชื่อและรูปโปรไฟล์ LINE ของคุณเพื่อใช้กับบัตรสะสมนี้เท่านั้น
            ไม่เก็บเบอร์โทรและไม่ส่งต่อให้ใคร
          </p>
        </div>
        <button className="btn" onClick={accept}>ยินยอมและเริ่มสะสม</button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="screen">
        <div className="grow center" style={{ gap: 12 }}>
          <p className="big">อ๊ะ</p>
          <p className="hint">{msg}</p>
        </div>
        <a href="/card" className="btn ghost" style={{ textDecoration: "none" }}>ดูบัตรของฉัน</a>
      </div>
    );
  }

  if (phase === "celebrate") {
    return (
      <div className="screen">
        <div className="grow center" style={{ gap: 20 }}>
          <div className="celebrate" style={{ width: "100%" }}>
            <div className="emo">🎉</div>
            <p className="what">{won.join(" · ")}</p>
            <p className="hint">แสดงหน้านี้ให้พนักงานตอนมารับได้เลย</p>
          </div>
          {state && <StampCard state={state} justStamped={justSlot} />}
        </div>
        <button className="btn" onClick={() => setPhase("card")}>ดูบัตรของฉัน</button>
      </div>
    );
  }

  if (phase === "picker" && picker?.ok) {
    return (
      <div className="screen">
        <div className="topbar"><h1>เลือกของรางวัล</h1></div>
        <p className="hint" style={{ marginBottom: 16 }}>แตะเลือกสิทธิ์ที่ต้องการใช้ตอนนี้</p>
        <div className="pick">
          {picker.entitlements.map((e) => (
            <button key={e.entitlement_id}
                    onClick={() => pick(e.entitlement_id, e.options[0]?.id)}>
              <span className="emo">🎁</span>
              <span>{e.options[0]?.name ?? e.label}</span>
            </button>
          ))}
        </div>
        <div className="grow" />
        <p className="hint" style={{ fontSize: 13 }}>
          เก็บสิทธิ์ที่เหลือไว้ใช้ครั้งหน้าได้ ไม่มีวันหมดอายุ
        </p>
      </div>
    );
  }

  if (phase === "redeemed") {
    return (
      <div className="screen">
        <div className="grow center" style={{ gap: 18 }}>
          <div className="card done" style={{ width: "100%" }}>
            <div className="tick" aria-hidden>✓</div>
            <p className="big">{given}</p>
            <p className="hint">รับของจากพนักงานได้เลย</p>
          </div>
        </div>
        <a href="/card" className="btn" style={{ textDecoration: "none" }}>ดูบัตรของฉัน</a>
      </div>
    );
  }

  // ---------- หน้าบัตรปกติ ----------
  return (
    <div className="screen">
      <div className="topbar"><h1>บัตรสะสมของฉัน</h1></div>
      {msg && <p className="err" style={{ marginBottom: 10 }}>{msg}</p>}
      {state?.card ? (
        <StampCard state={state} justStamped={justSlot} />
      ) : (
        <div className="grow center">
          <p className="hint">ยังไม่มีดวงเลย — สแกน QR จากพนักงานตอนจ่ายเงินได้เลย</p>
        </div>
      )}
      <div className="grow" />
      <p className="hint" style={{ fontSize: 13 }}>สะสมและใช้ได้ทุกสาขา · ไม่มีวันหมดอายุ</p>
    </div>
  );
}

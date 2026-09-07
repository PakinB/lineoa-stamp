"use client";

import type { CardState } from "@/lib/api-types";

/**
 * บัตรสแตมป์ 10 ช่อง
 *
 * §14: ข้อมูลมาจากเซิร์ฟเวอร์แบบพร้อมวาดแล้ว คอมโพเนนต์นี้จึงแค่ map
 * ห้ามคำนวณเองว่าช่องไหนเป็น checkpoint หรือเหลืออีกกี่ดวง
 */
export default function StampCard({
  state,
  justStamped,
}: {
  state: CardState;
  justStamped?: number | null;
}) {
  const card = state.card;
  if (!card) return null;

  return (
    <>
      <div className="card-head">
        <div className="no">บัตรใบที่ {card.card_no}</div>
        <div className="count">
          {card.filled}
          <small> / {card.size}</small>
        </div>
      </div>

      <div className="slots">
        {card.slots.map((s) => {
          const cp = s.checkpoint;
          const cls = [
            "dot",
            s.state === "filled" ? "on" : "",
            cp ? "cp" : "",
            cp && cp.status !== "locked" ? "claimed" : "",
            justStamped === s.no ? "just" : "",
          ].filter(Boolean).join(" ");

          return (
            <div className="slot" key={s.no}>
              <div className={cls}>
                <span className="pip" />
              </div>
              {cp ? <div className="gift">{cp.label}</div> : <div className="no">{s.no}</div>}
            </div>
          );
        })}
      </div>

      {state.next_checkpoint && (
        <p className="next-hint">
          อีก <b>{state.next_checkpoint.remaining}</b> ดวง
          {" "}ได้{" "}
          {card.slots.find((s) => s.no === state.next_checkpoint!.slot_no)?.checkpoint?.label}
        </p>
      )}

      {state.entitlements.length > 0 && (
        <div className="wallet">
          {state.entitlements.map((e) => (
            <span className="chip-r" key={e.id}>🎁 {e.label}</span>
          ))}
        </div>
      )}
    </>
  );
}

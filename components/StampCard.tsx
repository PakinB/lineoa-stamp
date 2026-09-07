"use client";

import type { CardState } from "@/lib/api-types";

/**
 * บัตรสแตมป์ La-Mi
 *
 * ใช้ไฟล์การ์ดจริงของร้านเป็นภาพพื้น แล้ววางตราประทับทับช่องที่สะสมแล้ว
 * ตำแหน่งช่องวัดจากไฟล์ต้นฉบับ 1537x1023 แปลงเป็นเปอร์เซ็นต์
 * จึงขยายย่อตามความกว้างจอได้โดยไม่หลุดตำแหน่ง
 *
 * §14: ข้อมูลมาจากเซิร์ฟเวอร์แบบพร้อมวาดแล้ว คอมโพเนนต์นี้แค่ map
 * ไม่คำนวณเองว่าช่องไหนเป็น checkpoint หรือเหลืออีกกี่ดวง
 */

// จุดกึ่งกลางของแต่ละช่องบนภาพการ์ด (เปอร์เซ็นต์)
const COL = [13.6, 31.78, 49.9, 68.12, 86.3];
const ROW = [56.94, 79.91];

function spot(no: number) {
  const i = no - 1;
  return { left: `${COL[i % 5]}%`, top: `${ROW[Math.floor(i / 5)]}%` };
}

export default function StampCard({
  state,
  justStamped,
}: {
  state: CardState;
  justStamped?: number | null;
}) {
  const card = state.card;
  if (!card) return null;

  const filled = card.slots.filter((s) => s.state === "filled");
  const nextLabel = state.next_checkpoint
    ? card.slots.find((s) => s.no === state.next_checkpoint!.slot_no)?.checkpoint?.label
    : null;

  return (
    <>
      <div className="card-head">
        <div className="count">
          {card.filled}
          <small> / {card.size}</small>
        </div>
      </div>

      <div className="lami">
        <img className="bg" src="/brand/stampbg.webp" alt={`บัตรสะสม La-Mi ใบที่ ${card.card_no}`} />
        {filled.map((s) => (
          <img
            key={s.no}
            className={`mark${justStamped === s.no ? " just" : ""}`}
            src="/brand/stampcomplete.webp"
            style={spot(s.no)}
            alt=""
          />
        ))}
      </div>

      {state.next_checkpoint && nextLabel && (
        <p className="next-hint">
          อีก <b>{state.next_checkpoint.remaining}</b> ดวง ได้ {nextLabel}
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

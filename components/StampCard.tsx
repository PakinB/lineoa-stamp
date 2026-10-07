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
const COL = [13.59, 31.77, 49.9, 68.18, 86.46];
const ROW = [56.48, 78.98];

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
        <img className="bg" src="/brand/stampbgnew1.webp" alt={`บัตรสะสม La-Mi ใบที่ ${card.card_no}`} />
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

      {/* ลูกค้าใหม่ที่เพิ่งกดเข้ามาครั้งแรก ต้องรู้ว่าดวงแรกได้มายังไง */}
      {card.filled === 0 && (
        <p className="next-hint" style={{ paddingTop: 2, fontSize: 13 }}>
          เริ่มสะสมได้เลย — สแกน QR จากพนักงานตอนจ่ายเงิน 1 บิลได้ 1 ดวง
        </p>
      )}

      {/*
        ก่อนหน้านี้เป็นชิป 🎁 ลอย ๆ ไม่มีหัวข้อ ลูกค้าจึงไม่รู้ว่านี่คือของที่
        "แลกได้แล้ว" ไม่ใช่รายการของรางวัลทั้งหมดของร้าน — ใส่หัวข้อกำกับให้ชัด
      */}
      {state.entitlements.length > 0 && (
        <section className="wallet-box">
          <h2 className="wallet-title">
            รางวัลที่คุณแลกได้
            <span className="wallet-count">{state.entitlements.length} สิทธิ์</span>
          </h2>

          <div className="wallet">
            {state.entitlements.map((e) => (
              <span className="chip-r" key={e.id}>🎁 {e.label}</span>
            ))}
          </div>

          <p className="wallet-note">แจ้งพนักงานที่หน้าเคาน์เตอร์เพื่อแลกของรางวัล · ไม่มีวันหมดอายุ</p>
        </section>
      )}
    </>
  );
}

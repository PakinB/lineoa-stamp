/**
 * สัญญา API ระหว่างเซิร์ฟเวอร์กับหน้าเว็บ
 *
 * กฎ (เอกสารออกแบบ §14): เซิร์ฟเวอร์คืนข้อมูล "พร้อมวาด" เสมอ
 * ฝั่งหน้าเว็บห้ามคำนวณกติกาธุรกิจเอง — ถ้าต้องเขียนเงื่อนไขคำนวณว่า
 * ช่องไหนเป็น checkpoint หรือเหลืออีกกี่ดวง แปลว่า API คืนข้อมูลไม่ครบ
 *
 * เหตุผลที่เข้มงวด: โค้ดฝั่งเบราว์เซอร์เป็นสิ่งที่ลูกค้าแก้ได้
 * กติกาที่หลุดไปอยู่ฝั่งนั้นคือกติกาที่บังคับไม่ได้
 */

// ---------------------------------------------------------------- บัตร ----

export type SlotState = "filled" | "empty";
export type CheckpointStatus = "locked" | "available" | "used";

export interface CardSlot {
  no: number;
  state: SlotState;
  /** ชื่อสาขาที่ปั๊มดวงนี้ — null ถ้ายังว่าง หรือมาจากเดลิเวอรี่ */
  branch: string | null;
  /** เวลาที่ปั๊ม (ISO 8601) — null ถ้ายังว่าง */
  at: string | null;
  /** null = ช่องธรรมดา ไม่มีรางวัลแปะอยู่ */
  checkpoint: { label: string; status: CheckpointStatus } | null;
}

export interface StampCard {
  id: string;
  /** ใบที่เท่าไหร่ของลูกค้าคนนี้ */
  card_no: number;
  size: number;
  filled: number;
  slots: CardSlot[];
}

export type EntitlementStatus = "available" | "used" | "voided";

export interface Entitlement {
  id: string;
  label: string;
  status: EntitlementStatus;
}

export interface CardState {
  /** null = ลูกค้าใหม่ที่ยังไม่มีบัตร */
  card: StampCard | null;
  /** รวมสิทธิ์จากบัตรใบเก่าที่ยังไม่ได้ใช้ด้วย — สแตมป์ไม่มีวันหมดอายุ */
  entitlements: Entitlement[];
  next_checkpoint: { slot_no: number; remaining: number } | null;
}

// ------------------------------------------------------------- สะสมดวง ----

export type StampFailReason =
  | "invalid_or_used"        // รหัสไม่ถูกต้อง หรือถูกใช้ไปแล้ว
  | "already_claimed_by_you" // คุณเองเป็นคนสแกนไปแล้ว
  | "rate_limited"           // เกินเพดานต่อวัน หรือยังไม่พ้นช่วงเว้น
  | "unauthenticated";

export interface NewEntitlement {
  id: string;
  slot_no: number;
  label: string;
}

export type ClaimTokenResponse =
  | {
      ok: true;
      /** true = ยิงซ้ำด้วยรหัสเดิม ไม่ได้ปั๊มเพิ่ม */
      duplicate: boolean;
      /**
       * ช่องที่เพิ่งถูกปั๊ม (1..size) — ใช้เล่นอนิเมชั่นตรงดวงนี้
       * มาจากเซิร์ฟเวอร์เพราะหน้าเว็บ diff เองไม่ได้:
       * ถ้าลูกค้าเปิดหน้าจากการสแกน QR ตรง ๆ จะไม่มีสถานะก่อนหน้าให้เทียบ
       */
      stamped_slot: number;
      /** บัตรใบนี้เต็มพอดี — จังหวะเล่นอนิเมชั่นปิดบัตรแล้วเปิดใบใหม่ */
      card_completed: boolean;
      /** สิทธิ์ที่เพิ่งเกิดจากการปั๊มครั้งนี้ — ใช้ตัดสินว่าจะโชว์หน้าฉลองไหม */
      new_entitlements: NewEntitlement[];
      /** สถานะบัตร "หลัง" ปั๊มแล้ว — อนิเมชั่นเล่นทับสถานะนี้ */
      card: CardState;
    }
  | { ok: false; reason: StampFailReason; card?: CardState };

// -------------------------------------------------------- คำขอเดลิเวอรี่ ----

export type ClaimRejectReason =
  | "not_a_receipt"
  | "other_restaurant"
  | "duplicate"
  | "too_old";

export interface DeliveryClaim {
  id: string;
  image_url: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  customer: {
    id: string;
    display_name: string | null;
    picture_url: string | null;
    /** สถานะบัตรตอนนี้ ให้คนอนุมัติเห็นบริบท */
    card_summary: string; // "7/10"
  };
  /** ธงเตือน — ใบที่ไม่มีธงกดอนุมัติรวดได้ */
  flags: Array<{
    kind: "frequent_claimer" | "similar_image" | "near_limit";
    message: string;
  }>;
}

// ---------------------------------------------------------- รับของรางวัล ----

/**
 * ไม่มีขั้นจอง ไม่มีรหัส 6 หลัก ไม่มี dialog ยืนยัน
 * พนักงานโชว์ QR -> ลูกค้าสแกน -> แตะเลือกสิทธิ์ -> ใช้เลย
 * การยืนยันคือการที่พนักงานส่งของให้ ไม่ใช่ปุ่มบนหน้าจอ
 */

/** พนักงานกด "รับรางวัล" -> ได้ QR ไว้โชว์ */
export interface RedeemTokenResponse {
  code: string;
  expires_at: string;
}

/** ลูกค้าสแกน QR ของพนักงาน -> เห็นสิทธิ์ที่ใช้ได้ ยังไม่ตัดอะไร */
export type RedeemableListResponse =
  | {
      ok: true;
      branch_id: string;
      entitlements: Array<{
        entitlement_id: string;
        label: string;
        /** ปกติมีตัวเดียว · ของที่เจ้าของปิดไว้ (เช่น โค้กหมด) จะไม่โผล่มาเลย */
        options: Array<{ id: string; name: string }>;
      }>;
    }
  | { ok: false; reason: "invalid_or_expired" };

/** ลูกค้าแตะเลือก -> ใช้สิทธิ์ทันที */
export type RedeemResponse =
  | { ok: true; entitlement_id: string; given: string; card: CardState }
  | {
      ok: false;
      reason:
        | "invalid_or_expired"
        | "entitlement_not_available"
        | "option_required"
        | "invalid_option";
    };

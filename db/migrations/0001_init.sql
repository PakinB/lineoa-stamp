-- ============================================================================
--  ระบบบัตรสแตมป์ร้านหมาล่า — โครงสร้างฐานข้อมูลเริ่มต้น
--
--  หลักการ (ดูเอกสารออกแบบ §3, §8):
--    1. stamp_ledger เป็น append-only ห้าม UPDATE/DELETE — เป็นแหล่งความจริงเดียว
--    2. ตัวนับ stamp_cards.filled เป็นแคช ต้องตรงกับจำนวนแถวใน ledger เสมอ
--    3. ความถูกต้องบังคับด้วย constraint ไม่ใช่ด้วยโค้ดแอป
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------- สาขา ------
CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,              -- 'ladprao'
  name        text NOT NULL,                     -- 'ลาดพร้าว'
  address     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- ลูกค้า ------
CREATE TABLE customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id      text NOT NULL UNIQUE,        -- กุญแจหลัก มาจาก LINE Login
  display_name      text,
  picture_url       text,
  consent_at        timestamptz,                 -- PDPA §13
  blocked_at        timestamptz,                 -- ระงับกรณีพบการทุจริต
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------- พนักงาน/สิทธิ์ ---
CREATE TYPE staff_role AS ENUM ('staff', 'manager', 'owner');

CREATE TABLE staff_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid REFERENCES branches(id),      -- owner เป็น null = ทุกสาขา
  name        text NOT NULL,
  role        staff_role NOT NULL DEFAULT 'staff',
  pin_hash    text NOT NULL,                     -- bcrypt/argon2 ห้ามเก็บ PIN ดิบ
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- staff/manager ต้องผูกสาขา owner เท่านั้นที่ไม่ผูกได้
  CONSTRAINT staff_needs_branch
    CHECK (role = 'owner' OR branch_id IS NOT NULL)
);
CREATE INDEX ix_staff_branch ON staff_users (branch_id) WHERE revoked_at IS NULL;

-- ------------------------------------------------------------ บัตรสแตมป์ ---
CREATE TYPE card_status AS ENUM ('active', 'completed');

CREATE TABLE stamp_cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  card_no      int  NOT NULL,                    -- ใบที่ 1, 2, 3...
  size         int  NOT NULL DEFAULT 10,         -- ล็อกตอนเปิด บัตรเก่าไม่กระทบถ้าเปลี่ยนกติกา
  filled       int  NOT NULL DEFAULT 0,          -- แคช ต้องตรงกับจำนวนแถวใน ledger
  status       card_status NOT NULL DEFAULT 'active',
  opened_at    timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (customer_id, card_no),
  CONSTRAINT card_filled_in_range CHECK (filled BETWEEN 0 AND size),
  CONSTRAINT card_size_positive   CHECK (size > 0),
  CONSTRAINT card_completed_when_full
    CHECK (status <> 'completed' OR (filled = size AND completed_at IS NOT NULL))
);
-- ลูกค้าหนึ่งคนมีบัตรที่เปิดอยู่ได้ใบเดียวเท่านั้น
CREATE UNIQUE INDEX uq_one_active_card
  ON stamp_cards (customer_id) WHERE status = 'active';

-- ------------------------------------------------- บัญชีแยกประเภทสแตมป์ ---
-- APPEND-ONLY: ห้าม UPDATE ห้าม DELETE (มี trigger บังคับใน 0002)
CREATE TYPE stamp_source AS ENUM ('qr', 'delivery', 'manual');

CREATE TABLE stamp_ledger (
  id              bigserial PRIMARY KEY,
  customer_id     uuid NOT NULL REFERENCES customers(id),
  card_id         uuid NOT NULL REFERENCES stamp_cards(id),
  slot_no         int  NOT NULL,                 -- 1..card.size
  branch_id       uuid REFERENCES branches(id),  -- ดูสถิติเท่านั้น ไม่ใช้เคลียร์ยอด
  source          stamp_source NOT NULL,
  note            text,                          -- บังคับกรอกเมื่อ source = 'manual'
  idempotency_key text NOT NULL,                 -- รหัส QR / id คำขอเดลิเวอรี่
  created_by      uuid REFERENCES staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stamp_idem UNIQUE (idempotency_key),
  -- สองดวงลงช่องเดียวกันของบัตรใบเดียวกันไม่ได้เด็ดขาด
  CONSTRAINT uq_stamp_slot UNIQUE (card_id, slot_no),
  CONSTRAINT stamp_slot_positive CHECK (slot_no > 0),
  CONSTRAINT manual_needs_note
    CHECK (source <> 'manual' OR (note IS NOT NULL AND created_by IS NOT NULL))
);
CREATE INDEX ix_ledger_customer ON stamp_ledger (customer_id, created_at DESC);
CREATE INDEX ix_ledger_branch   ON stamp_ledger (branch_id, created_at DESC);
CREATE INDEX ix_ledger_card     ON stamp_ledger (card_id, slot_no);

-- ------------------------------------------------------ รางวัล/checkpoint ---
CREATE TABLE reward_checkpoints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_no    int  NOT NULL UNIQUE,               -- ช่องที่มีรางวัลแปะอยู่ เช่น 5, 10
  label      text NOT NULL,                      -- 'ของแถมเล็ก'
  is_active  boolean NOT NULL DEFAULT true,
  CONSTRAINT checkpoint_slot_positive CHECK (slot_no > 0)
);

-- ตัวเลือกที่พนักงานกดเลือกให้ลูกค้า — ไม่ใช่สต็อก ไม่ต้องแม่นยำ (§2)
CREATE TABLE reward_options (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid NOT NULL REFERENCES reward_checkpoints(id) ON DELETE CASCADE,
  name          text NOT NULL,                   -- 'เครื่องดื่มฟรี 2 แก้ว'
  sort          int  NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true
);
CREATE INDEX ix_options_checkpoint ON reward_options (checkpoint_id, sort)
  WHERE is_active;

-- ------------------------------------------------------------- สิทธิ์รางวัล ---
-- ไม่มีสถานะ 'holding' เพราะไม่มีขั้นจอง — ลูกค้าสแกน QR ของพนักงานแล้วเลือกใช้ได้เลย
-- การยืนยันคือการที่พนักงานส่งของให้ ไม่ใช่ dialog บนหน้าจอ
CREATE TYPE entitlement_status AS ENUM ('available', 'used', 'voided');

CREATE TABLE entitlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES customers(id),
  card_id          uuid NOT NULL REFERENCES stamp_cards(id),
  checkpoint_id    uuid NOT NULL REFERENCES reward_checkpoints(id),
  slot_no          int  NOT NULL,
  status           entitlement_status NOT NULL DEFAULT 'available',
  used_at          timestamptz,
  used_branch_id   uuid REFERENCES branches(id),
  chosen_option_id uuid REFERENCES reward_options(id),
  confirmed_by     uuid REFERENCES staff_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- หนึ่ง checkpoint บนหนึ่งบัตร ให้สิทธิ์ได้ครั้งเดียวตลอดกาล
  CONSTRAINT uq_entitlement_card_checkpoint UNIQUE (card_id, checkpoint_id),
  CONSTRAINT used_has_details
    CHECK (status <> 'used' OR (used_at IS NOT NULL AND confirmed_by IS NOT NULL))
);
CREATE INDEX ix_entitlement_customer
  ON entitlements (customer_id) WHERE status = 'available';

-- ------------------------------------------------------------ QR โหมด A ---
CREATE TYPE token_status AS ENUM ('active', 'consumed', 'expired', 'voided');

CREATE TABLE earn_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,              -- Base32 16 ตัว จาก crypto.randomBytes
  branch_id   uuid NOT NULL REFERENCES branches(id),
  order_ref   text,                              -- เลขบิล ไว้กระทบยอดกับ POS
  status      token_status NOT NULL DEFAULT 'active',
  expires_at  timestamptz,                       -- null = ไม่หมดอายุ (สำรอง)
  issued_by   uuid REFERENCES staff_users(id),
  issued_at   timestamptz NOT NULL DEFAULT now(),
  consumed_by uuid REFERENCES customers(id),
  consumed_at timestamptz,
  CONSTRAINT consumed_has_details
    CHECK (status <> 'consumed' OR (consumed_by IS NOT NULL AND consumed_at IS NOT NULL))
);
-- ค้นหาตอนเคลม: ใช้ code เป็นหลัก (unique index ครอบคลุมแล้ว)
CREATE INDEX ix_token_branch_open
  ON earn_tokens (branch_id, issued_at DESC) WHERE status = 'active';

-- ------------------------------------------------- QR รับรางวัล (ฝั่งร้าน) ---
-- พนักงานกดออก QR นี้ตอนลูกค้ามารับรางวัล แล้วลูกค้าสแกนด้วยกล้อง LINE
-- ทิศทางเดียวกับตอนสะสมแต้ม ลูกค้าจึงไม่ต้องเรียนรู้ท่าใหม่
-- และเครื่องพนักงานไม่ต้องมีกล้อง
CREATE TABLE redeem_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  branch_id      uuid NOT NULL REFERENCES branches(id),
  status         token_status NOT NULL DEFAULT 'active',
  expires_at     timestamptz NOT NULL,          -- สั้นกว่า QR สะสม ลูกค้ายืนอยู่ตรงหน้าแล้ว
  issued_by      uuid REFERENCES staff_users(id),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  consumed_by    uuid REFERENCES customers(id),
  consumed_at    timestamptz,
  entitlement_id uuid REFERENCES entitlements(id),  -- สิทธิ์ที่ลูกค้าเลือกใช้
  CONSTRAINT redeem_consumed_has_details
    CHECK (status <> 'consumed'
           OR (consumed_by IS NOT NULL AND consumed_at IS NOT NULL
               AND entitlement_id IS NOT NULL))
);
CREATE INDEX ix_redeem_branch_open
  ON redeem_tokens (branch_id, issued_at DESC) WHERE status = 'active';

-- -------------------------------------------- คำขอสแตมป์เดลิเวอรี่ (รูป) ---
-- ลูกค้าส่งรูปใบเสร็จเข้าแชท LINE -> เจ้าของกดอนุมัติ -> ปั๊มสแตมป์
CREATE TYPE claim_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE delivery_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id),
  image_hash      text NOT NULL,                 -- SHA-256 ของไฟล์ กันส่งรูปเดิมซ้ำ
  image_path      text NOT NULL,                 -- ที่เก็บใน object storage
  line_message_id text,                          -- id ข้อความต้นทางใน LINE
  status          claim_status NOT NULL DEFAULT 'pending',
  reject_reason   text,
  reviewed_by     uuid REFERENCES staff_users(id),
  reviewed_at     timestamptz,
  stamp_id        bigint REFERENCES stamp_ledger(id),  -- ดวงที่เกิดจากคำขอนี้
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewed_has_details
    CHECK (status = 'pending' OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)),
  CONSTRAINT rejected_has_reason
    CHECK (status <> 'rejected' OR reject_reason IS NOT NULL),
  CONSTRAINT approved_has_stamp
    CHECK (status <> 'approved' OR stamp_id IS NOT NULL)
);
-- รูปเดิมใช้ขอซ้ำไม่ได้ แต่ถ้าเคยถูกปฏิเสธ ให้ส่งใหม่ได้ (เผื่อปฏิเสธพลาด)
CREATE UNIQUE INDEX uq_claim_image
  ON delivery_claims (image_hash) WHERE status <> 'rejected';
CREATE INDEX ix_claims_pending
  ON delivery_claims (created_at) WHERE status = 'pending';
CREATE INDEX ix_claims_customer
  ON delivery_claims (customer_id, created_at DESC);

-- --------------------------------------------------------- ค่าตั้งค่าระบบ ---
-- §6: ตัวเลขกันโกงต้องแก้ได้จากหน้าแอดมิน ห้ามฝังเป็นค่าคงที่ในโค้ด
CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES staff_users(id)
);

-- --------------------------------------------------------------- บันทึก ---
CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_type text NOT NULL,                      -- 'staff' | 'customer' | 'system'
  actor_id   uuid,
  action     text NOT NULL,                      -- 'claim.approve', 'stamp.manual', ...
  target     text,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_created ON audit_logs (created_at DESC);
CREATE INDEX ix_audit_actor   ON audit_logs (actor_id, created_at DESC);

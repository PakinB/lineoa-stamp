-- ============================================================================
-- 0013: เดลิเวอรี่ — โครงสร้างข้อมูล
--
--  ลูกค้าสั่งผ่าน LIFF ในแชท LINE แล้วพนักงานร้านขับไปส่งเอง ไม่มีไรเดอร์
--  แทนการรับโทรศัพท์ · ออกแบบหน้าจอไว้แล้ว 12 จอ เจ้าของเคาะ 13 ต.ค. 2026
--
--  ⚠️ นี่เป็นครั้งแรกที่ระบบเก็บ "เบอร์โทรและที่อยู่" ซึ่งเดิมกติกาห้ามไว้
--  เจ้าของเคาะแล้วเพราะคนขับต้องโทรหาลูกค้าได้ · เก็บไว้ที่ออเดอร์ ไม่ใช่ที่
--  ตัวลูกค้า เพื่อให้ลบออเดอร์เก่าทิ้งแล้วข้อมูลส่วนตัวหายไปด้วย (ดู CLAUDE.md)
--
--  ราคา: คิดตามน้ำหนัก ขีดละ 45 บาท · เซ็ตสำเร็จ 300/500/800 ก.
--  กำหนดเองขั้นต่ำ 400 ก. เพิ่มทีละ 100 ก. — ล็อกเป็นขั้นละขีดเพื่อให้ราคา
--  เป็นจำนวนเต็มเสมอ ไม่มีเศษสตางค์ให้ลูกค้าสงสัย
-- ============================================================================

CREATE TYPE delivery_status AS ENUM (
  'placed',     -- ลูกค้ากดสั่งแล้ว · ถ้าโอนต้องรอตรวจสลิปก่อน
  'accepted',   -- พนักงานกดรับออเดอร์
  'cooking',    -- กำลังทำอาหาร
  'out',        -- ออกจากร้านแล้ว
  'delivered',  -- ส่งถึงแล้ว ปิดงาน
  'cancelled'
);

CREATE TYPE delivery_pay_method AS ENUM ('cod', 'transfer');


-- ─────────────────────────────────────────────── โซนจัดส่งและค่าส่ง ───
-- คิดค่าส่งจากโซนที่ลูกค้าเลือกเอง ไม่ใช้ API แผนที่คิดระยะ จึงไม่มีค่าใช้จ่าย
CREATE TABLE delivery_zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id  uuid REFERENCES branches(id),   -- null = ใช้ได้ทุกสาขา
  name       text NOT NULL,
  note       text,                            -- "ไม่เกิน 5 กม."
  fee        int  NOT NULL CHECK (fee >= 0),
  sort       int  NOT NULL DEFAULT 1,
  is_active  boolean NOT NULL DEFAULT true
);


-- ──────────────────────────────────────── เมนู: วัตถุดิบและเครื่องดื่ม ───
-- วัตถุดิบเป็น "ข้อความล้วน ไม่มีรูป" ตามที่เจ้าของเคาะ — ไม่ต้องถ่ายรูป
-- ไม่ต้องเก็บไฟล์ภาพ และเพิ่มลดรายการจากหน้าแอดมินได้ทันที
CREATE TABLE delivery_menu_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind      text NOT NULL CHECK (kind IN ('ingredient', 'drink', 'spicy', 'soup')),
  name      text NOT NULL,
  -- เครื่องดื่มมีราคาต่อชิ้น · วัตถุดิบ/ความเผ็ด/น้ำซุป ไม่คิดเงินแยก
  -- เพราะราคาหมาล่าคิดจากน้ำหนักรวมอยู่แล้ว
  price     int  NOT NULL DEFAULT 0 CHECK (price >= 0),
  sort      int  NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX ix_menu_kind ON delivery_menu_items (kind, sort) WHERE is_active;


-- ───────────────────────────────────────────── เซ็ตน้ำหนักสำเร็จรูป ───
CREATE TABLE delivery_weight_presets (
  grams     int PRIMARY KEY CHECK (grams > 0 AND grams % 100 = 0),
  sort      int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true
);


-- ─────────────────────────────────────────────────────── ส่วนลดตามช่วง ───
-- แยกจาก promo_campaigns โดยตั้งใจ — ตัวนั้นให้ "สแตมป์เพิ่ม" ตัวนี้ให้ "เงินลด"
-- คนละเรื่องกันคนละตาราง จะได้ไม่ปนกันตอนทำรายงาน
CREATE TABLE delivery_discounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  percent    int  NOT NULL CHECK (percent BETWEEN 1 AND 100),
  -- คิดจากค่าอาหารอย่างเดียว ไม่ลดค่าส่ง เพราะค่าส่งเป็นต้นทุนที่ร้านจ่ายจริง
  applies_to text NOT NULL DEFAULT 'food' CHECK (applies_to IN ('food', 'grand')),
  min_total  int,                            -- null = ไม่มีขั้นต่ำ
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES staff_users(id),
  CONSTRAINT discount_range CHECK (ends_at > starts_at)
);
CREATE INDEX ix_discount_live ON delivery_discounts (starts_at, ends_at) WHERE is_active;


-- ─────────────────────────────────────────────────────────── ออเดอร์ ───
CREATE SEQUENCE delivery_order_seq START 1001;

CREATE TABLE delivery_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no    text NOT NULL UNIQUE,          -- A-1042 · อ่านออกตอนคุยโทรศัพท์
  customer_id uuid NOT NULL REFERENCES customers(id),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  zone_id     uuid NOT NULL REFERENCES delivery_zones(id),
  status      delivery_status NOT NULL DEFAULT 'placed',

  -- ที่อยู่จัดส่ง — ข้อมูลส่วนบุคคล เก็บเท่าที่คนขับต้องใช้
  address     text NOT NULL,
  phone       text NOT NULL,
  lat         numeric(9,6),                  -- จากการปักหมุดในเบราว์เซอร์ (ฟรี)
  lng         numeric(9,6),
  rider_note  text,

  -- เงิน · ทุกค่าเป็นจำนวนเต็มบาท ไม่มีเศษสตางค์โดยตั้งใจ
  food_total   int NOT NULL CHECK (food_total  >= 0),
  delivery_fee int NOT NULL CHECK (delivery_fee >= 0),
  discount     int NOT NULL DEFAULT 0 CHECK (discount >= 0),
  grand_total  int NOT NULL CHECK (grand_total >= 0),
  discount_id  uuid REFERENCES delivery_discounts(id),

  pay_method   delivery_pay_method NOT NULL,
  slip_path    text,                         -- ไฟล์ใน bucket receipts
  slip_ref     text,                         -- เลขอ้างอิงจาก QR ท้ายสลิป
  paid_by      uuid REFERENCES staff_users(id),
  paid_at      timestamptz,

  -- ขั้นตอนทำงาน · เก็บว่าใครทำอะไรเมื่อไหร่ เพื่อกระทบยอดตอนปิดร้าน
  accepted_by  uuid REFERENCES staff_users(id),
  accepted_at  timestamptz,
  cooking_at   timestamptz,
  out_at       timestamptz,
  rider_id     uuid REFERENCES staff_users(id),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,

  stamp_id    bigint REFERENCES stamp_ledger(id),  -- ดวงที่ปั๊มให้ตอนส่งถึง
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- ส่งถึงแล้วต้องรู้ว่าใครส่งและเมื่อไหร่ ไม่งั้นกระทบยอดเงินสดไม่ได้
  CONSTRAINT delivered_has_rider
    CHECK (status <> 'delivered' OR (rider_id IS NOT NULL AND delivered_at IS NOT NULL)),
  CONSTRAINT cancelled_has_reason
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

-- กันส่งสลิปใบเดิมซ้ำ — แข็งแรงกว่า hash รูป เพราะแก้รูปหนึ่งพิกเซล hash ก็เปลี่ยน
CREATE UNIQUE INDEX ux_order_slip_ref ON delivery_orders (slip_ref) WHERE slip_ref IS NOT NULL;

CREATE INDEX ix_order_queue  ON delivery_orders (branch_id, status, created_at);
CREATE INDEX ix_order_mine   ON delivery_orders (customer_id, created_at DESC);
CREATE INDEX ix_order_active ON delivery_orders (customer_id)
  WHERE status IN ('placed','accepted','cooking','out');


-- ──────────────────────────────────────────────── รายการในออเดอร์ ───
CREATE TABLE delivery_order_items (
  id       bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  kind     text NOT NULL CHECK (kind IN ('mala', 'drink')),
  name     text NOT NULL,              -- "หมาล่า 500 ก." หรือ "โค้ก กระป๋อง"
  grams    int,                        -- null สำหรับเครื่องดื่ม
  qty      int NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price int NOT NULL CHECK (unit_price >= 0),
  total      int NOT NULL CHECK (total >= 0),
  -- ตัวเลือกของหมาล่า เก็บเป็นข้อความเพื่อให้ครัวอ่านได้ตรง ๆ
  spicy    text,
  soup     text,
  ingredients text[]
);
CREATE INDEX ix_order_items ON delivery_order_items (order_id);


-- ═══════════════════════════════════════════════ ค่าตั้งต้นและข้อมูลเริ่ม ═══

INSERT INTO app_settings (key, value, description) VALUES
  ('delivery_enabled',        'true', 'เปิด/ปิดระบบเดลิเวอรี่ทั้งหมด'),
  ('delivery_open',           'true', 'รับออเดอร์อยู่ไหม — พนักงานกดปิดชั่วคราวได้เมื่อครัวแน่น'),
  ('delivery_price_per_100g', '45',   'ราคาหมาล่าต่อ 100 กรัม (ขีดละ)'),
  ('delivery_min_grams',      '400',  'น้ำหนักขั้นต่ำเมื่อลูกค้ากำหนดเอง'),
  ('delivery_grams_step',     '100',  'เพิ่มน้ำหนักทีละกี่กรัม — ล็อกไว้ที่ 100 เพื่อให้ราคาเป็นจำนวนเต็ม'),
  ('delivery_eta_min',        '35',   'เวลาส่งโดยประมาณ ต่ำสุด (นาที)'),
  ('delivery_eta_max',        '50',   'เวลาส่งโดยประมาณ สูงสุด (นาที)'),
  ('delivery_max_active',     'null', 'จำกัดออเดอร์ที่ยังไม่ส่งพร้อมกัน — null = ไม่จำกัด')
ON CONFLICT (key) DO NOTHING;

INSERT INTO delivery_weight_presets (grams, sort) VALUES (300,1),(500,2),(800,3)
ON CONFLICT (grams) DO NOTHING;

INSERT INTO delivery_zones (name, note, fee, sort) VALUES
  ('โซน A', 'ในหมู่บ้าน',   20, 1),
  ('โซน B', 'ไม่เกิน 5 กม.', 40, 2),
  ('โซน C', '5–10 กม.',      60, 3);

INSERT INTO delivery_menu_items (kind, name, price, sort) VALUES
  ('ingredient','หมูสไลซ์',      0, 1),
  ('ingredient','เนื้อวัวสไลซ์',  0, 2),
  ('ingredient','ลูกชิ้นปลา',     0, 3),
  ('ingredient','ลูกชิ้นกุ้ง',     0, 4),
  ('ingredient','เห็ดเข็มทอง',    0, 5),
  ('ingredient','เห็ดหอม',       0, 6),
  ('ingredient','ผักกาดขาว',     0, 7),
  ('ingredient','ผักบุ้ง',        0, 8),
  ('ingredient','เต้าหู้ปลา',     0, 9),
  ('ingredient','ฟองเต้าหู้',     0,10),
  ('ingredient','บะหมี่เหลือง',   0,11),
  ('ingredient','วุ้นเส้น',       0,12),
  ('ingredient','ไส้กรอก',       0,13),
  ('ingredient','ปูอัด',         0,14),
  ('spicy','ไม่เผ็ด',    0, 1),
  ('spicy','เผ็ดน้อย',   0, 2),
  ('spicy','เผ็ดกลาง',   0, 3),
  ('spicy','เผ็ดมาก',    0, 4),
  ('soup','มาล่า',       0, 1),
  ('soup','กระดูกหมู',    0, 2),
  ('soup','ต้มยำ',       0, 3),
  ('drink','โค้ก กระป๋อง',  20, 1),
  ('drink','น้ำเก๊กฮวย',    25, 2);

-- ส่วนลดเปิดร้าน 10% ถึงสิ้นเดือนตุลาคม 2026 (เวลาไทย)
-- เดือนถัดไปเจ้าของสร้างตัวใหม่เองได้จากหน้าแอดมิน ไม่ต้องแก้โค้ด
INSERT INTO delivery_discounts (name, percent, applies_to, starts_at, ends_at) VALUES
  ('ส่วนลดเปิดร้าน 10%', 10, 'food',
   '2026-10-01 00:00:00+07', '2026-11-01 00:00:00+07');

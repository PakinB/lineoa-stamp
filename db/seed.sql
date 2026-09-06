-- ============================================================================
--  ข้อมูลตั้งต้น — แก้ให้ตรงกับร้านจริงก่อนใช้งาน
-- ============================================================================

-- ------------------------------------------------------------------ สาขา ---
INSERT INTO branches (code, name) VALUES
  ('main', 'สาขาหลัก')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------- checkpoint และของรางวัล ---
-- ค่าเริ่มต้น: รางวัลกลางทางที่ช่อง 5 และรางวัลใหญ่ที่ช่อง 10
-- ถ้าอยากได้ checkpoint เดียว ตั้ง is_active = false ให้ช่อง 5
INSERT INTO reward_checkpoints (slot_no, label) VALUES
  (5,  'ของแถมเล็ก'),
  (10, 'ของรางวัลใหญ่')
ON CONFLICT (slot_no) DO NOTHING;

INSERT INTO reward_options (checkpoint_id, name, sort)
SELECT c.id, v.name, v.sort
  FROM reward_checkpoints c
  JOIN (VALUES
    (5,  'เครื่องดื่มฟรี 1 แก้ว', 1),
    (5,  'ไข่ต้ม/เต้าหู้ ฟรี 1 ที่', 2),
    (10, 'หม้อไฟเล็ก ฟรี 1 ที่', 1),
    (10, 'เครื่องดื่มฟรี 2 แก้ว',  2),
    (10, 'ส่วนลด 150 บาท',        3)
  ) AS v(slot, name, sort) ON v.slot = c.slot_no
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------ ค่าตั้งค่า ---
-- §6: ตัวเลขกันโกงต้องแก้ได้จากหน้าแอดมิน ห้ามฝังในโค้ด
INSERT INTO app_settings (key, value, description) VALUES
  ('card_size',              '10',   'จำนวนช่องต่อบัตรหนึ่งใบ'),
  ('token_ttl_minutes',      '10',   'อายุ QR ก่อนหมดอายุ (นาที)'),
  ('hold_ttl_minutes',       '5',    'อายุรหัสจองรางวัล 6 หลัก (นาที)'),
  ('cooldown_minutes',       '90',   'เว้นช่วงขั้นต่ำต่อคนต่อสาขา (นาที)'),
  ('max_stamps_per_day',     '3',    'เพดานดวงต่อคนต่อวัน — แนวป้องกันหลักเพราะไม่มีขั้นต่ำต่อบิล'),
  ('max_delivery_per_week',  '3',    'เพดานคำขอเดลิเวอรี่ต่อคนต่อสัปดาห์'),
  ('delivery_claim_enabled', 'true', 'เปิด/ปิดการขอสแตมป์จากเดลิเวอรี่')
ON CONFLICT (key) DO NOTHING;

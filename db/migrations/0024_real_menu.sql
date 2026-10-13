-- ============================================================================
-- 0024: เมนูจริงของร้าน — วัตถุดิบ 60 รายการ + เมนูพิเศษ
--
--  ของเดิม 14 รายการเป็นแค่ตัวอย่างที่ผมใส่ไว้ให้เห็นภาพ · อันนี้ของจริง
--
--  เพิ่มสามอย่างในตาราง
--   · name_en   ชื่ออังกฤษ ลูกค้าต่างชาติอ่านได้ และใช้ค้นหาได้
--   · category  กลุ่มของวัตถุดิบ เพื่อให้หน้าสั่งแบ่งหมวดได้ ไม่ใช่ลิสต์ยาว 60 บรรทัด
--   · kind 'dish' เมนูจานเดียวราคาคงที่ ไม่ได้คิดตามน้ำหนัก
-- ============================================================================

ALTER TABLE delivery_menu_items ADD COLUMN IF NOT EXISTS name_en  text;
ALTER TABLE delivery_menu_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE delivery_menu_items ADD COLUMN IF NOT EXISTS note     text;

ALTER TABLE delivery_menu_items DROP CONSTRAINT IF EXISTS delivery_menu_items_kind_check;
ALTER TABLE delivery_menu_items
  ADD CONSTRAINT delivery_menu_items_kind_check
  CHECK (kind IN ('ingredient', 'drink', 'spicy', 'soup', 'dish'));

-- เมนูจานเดียวก็เป็นรายการในออเดอร์ได้เหมือนเครื่องดื่ม
ALTER TABLE delivery_order_items DROP CONSTRAINT IF EXISTS delivery_order_items_kind_check;
ALTER TABLE delivery_order_items
  ADD CONSTRAINT delivery_order_items_kind_check
  CHECK (kind IN ('mala', 'drink', 'dish'));


-- ───────────────────────────────────── ล้างวัตถุดิบตัวอย่างทิ้ง ───
-- ลบได้เพราะยังไม่มีออเดอร์จริงอ้างถึง (ออเดอร์เก็บชื่อวัตถุดิบเป็นข้อความ
-- ไม่ได้เก็บเป็น foreign key อยู่แล้ว ประวัติเก่าจึงไม่เสียหายแม้เมนูเปลี่ยน)
DELETE FROM delivery_menu_items WHERE kind = 'ingredient';


INSERT INTO delivery_menu_items (kind, category, name, name_en, sort) VALUES
  -- ── เนื้อสัตว์และเครื่องใน ──
  ('ingredient','เนื้อสัตว์','ตับหั่น','Sliced Liver',1),
  ('ingredient','เนื้อสัตว์','สไบนาง','Pork Uterus (Sabai Nang)',2),
  ('ingredient','เนื้อสัตว์','หมูเด้ง','Bouncy Pork',3),
  ('ingredient','เนื้อสัตว์','ไส้เป็ด','Duck Intestine',4),
  ('ingredient','เนื้อสัตว์','ตับหมูหมัก','Marinated Pork Liver',5),
  ('ingredient','เนื้อสัตว์','สามชั้นหมักงา','Sesame Marinated Pork Belly',6),
  ('ingredient','เนื้อสัตว์','หมูสันคอ','Sliced Pork Neck',7),
  ('ingredient','เนื้อสัตว์','หมูสามชั้น','Pork Belly',8),
  ('ingredient','เนื้อสัตว์','เนื้อสันคอ','Sliced Beef Chuck',9),

  -- ── อาหารทะเล ──
  ('ingredient','ทะเล','ปลาดอลลี่หั่นชิ้น','Sliced Dory Fish',1),
  ('ingredient','ทะเล','ปลาหมึกกรอบ','Crispy Squid',2),
  ('ingredient','ทะเล','หนวดหมึกเรด้าหั่น','Sliced Squid Tentacles',3),
  ('ingredient','ทะเล','หอยแมลงภู่','Mussels',4),
  ('ingredient','ทะเล','แมงกะพรุน','Jellyfish',5),

  -- ── ลูกชิ้นและของแปรรูป ──
  ('ingredient','ลูกชิ้น','ชิกุวะ (ลูกชิ้นปลาหลอด)','Chikuwa Fish Tube',1),
  ('ingredient','ลูกชิ้น','ปูอัด','Crab Stick',2),
  ('ingredient','ลูกชิ้น','ปูอัดเมก้าแครบ','Mega Crab Stick',3),
  ('ingredient','ลูกชิ้น','ลูกชิ้นปลาแฟนซี','Fancy Fish Balls',4),
  ('ingredient','ลูกชิ้น','ลูกชิ้นหนังกรอบ','Crispy Pork Meatball',5),
  ('ingredient','ลูกชิ้น','เล็บมือนาง','Lep Mue Nang Rolls',6),
  ('ingredient','ลูกชิ้น','ไก่พันสาหร่าย','Chicken Seaweed Roll',7),
  ('ingredient','ลูกชิ้น','ไข่นกกระทา','Quail Eggs',8),
  ('ingredient','ลูกชิ้น','ฟองเต้าหู้แท่ง','Tofu Skin Stick',9),
  ('ingredient','ลูกชิ้น','ฟองเต้าหู้ตัด','Cut Tofu Skin',10),
  ('ingredient','ลูกชิ้น','อาบูราอาเกะ','Aburaage',11),
  ('ingredient','ลูกชิ้น','เต้าหู้ชีส','Cheese Tofu',12),
  ('ingredient','ลูกชิ้น','เต้าหู้ปลาลูกเต๋า','Diced Fish Tofu',13),

  -- ── ผัก ──
  ('ingredient','ผัก','ผักกาดขาว','Napa Cabbage',1),
  ('ingredient','ผัก','ผักกวางตุ้ง','Choy Sum',2),
  ('ingredient','ผัก','ผักป่วยเล้ง','Chinese Spinach',3),
  ('ingredient','ผัก','ผักตั้งโอ๋','Chrysanthemum Greens',4),
  ('ingredient','ผัก','ผักกาดหอมนอก','Lettuce',5),
  ('ingredient','ผัก','ผักชีฝรั่ง','Culantro',6),
  ('ingredient','ผัก','ต้นอ่อนทานตะวัน','Sunflower Sprouts',7),
  ('ingredient','ผัก','กะหล่ำดอก','Cauliflower',8),
  ('ingredient','ผัก','บล็อกโคลี','Broccoli',9),
  ('ingredient','ผัก','ข้าวโพดอ่อน','Baby Corn',10),
  ('ingredient','ผัก','ถั่วลันเตา','Snow Peas',11),
  ('ingredient','ผัก','กระเจี๊ยบ','Okra',12),
  ('ingredient','ผัก','แครอท','Carrot',13),
  ('ingredient','ผัก','ฟักทอง','Pumpkin',14),
  ('ingredient','ผัก','มันฝรั่ง','Potato',15),
  ('ingredient','ผัก','รากบัวแผ่น','Sliced Lotus Root',16),
  ('ingredient','ผัก','สาหร่ายวากาเมะ','Wakame Seaweed',17),

  -- ── เห็ด ──
  ('ingredient','เห็ด','เห็ดเข็มทอง','Enoki Mushroom',1),
  ('ingredient','เห็ด','เห็ดหอมสดบั้งลายดอก','Fresh Shiitake Mushroom',2),
  ('ingredient','เห็ด','เห็ดออรินจิ','King Oyster Mushroom',3),
  ('ingredient','เห็ด','เห็ดชิเมจิดำ','Black Shimeji Mushroom',4),
  ('ingredient','เห็ด','เห็ดหูหนู','Wood Ear Mushroom',5),
  ('ingredient','เห็ด','เห็ดหูหนูขาว','White Wood Ear',6),

  -- ── เส้น ──
  ('ingredient','เส้น','วุ้นเส้น','Glass Noodles',1),
  ('ingredient','เส้น','เส้นบะหมี่สด','Fresh Egg Noodles',2),
  ('ingredient','เส้น','หมี่หยก','Jade Noodles',3),
  ('ingredient','เส้น','เส้นอูด้ง','Udon Noodle',4),
  ('ingredient','เส้น','เส้นมาม่า','Instant Noodles',5),
  ('ingredient','เส้น','เส้นบุก','Konjac Noodles',6),
  ('ingredient','เส้น','เส้นมัน','Sweet Potato Noodle',7),
  ('ingredient','เส้น','เส้นแก้วเล็ก','Small Kelp Noodle',8),
  ('ingredient','เส้น','เส้นแก้วใหญ่','Large Kelp Noodle',9);


-- ───────────────────────────────────────────────── เมนูพิเศษ ───
-- ราคาคงที่ ไม่ได้คิดตามน้ำหนัก · สั่งแยกจากหมาล่าได้เลย
INSERT INTO delivery_menu_items (kind, category, name, name_en, price, note, sort) VALUES
  ('dish','เมนูพิเศษ','ปลาต้มผักกาดดองโบราณ','Boiled Fish with Pickled Cabbage',199,'พร้อมข้าวสวย 1 ถ้วย',1),
  ('dish','เมนูพิเศษ','หมูผัดพริกหยวก','Stir-fried Pork with Bell Pepper',199,'พร้อมข้าวสวย 1 ถ้วย',2);

-- เครื่องดื่มเดิมใส่ชื่ออังกฤษให้ด้วย
UPDATE delivery_menu_items SET name_en='Coca-Cola (Can)',  category='เครื่องดื่ม' WHERE kind='drink' AND name='โค้ก กระป๋อง';
UPDATE delivery_menu_items SET name_en='Chrysanthemum Tea', category='เครื่องดื่ม' WHERE kind='drink' AND name='น้ำเก๊กฮวย';

CREATE INDEX IF NOT EXISTS ix_menu_category ON delivery_menu_items (kind, category, sort) WHERE is_active;

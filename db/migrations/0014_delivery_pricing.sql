-- ============================================================================
-- 0014: เดลิเวอรี่ — ตรรกะคิดราคาและสร้างออเดอร์
--
--  ⚠️ ราคาทุกบาทคำนวณฝั่งฐานข้อมูลทั้งหมด **ห้ามรับราคาจากเบราว์เซอร์**
--  หน้าเว็บส่งมาแค่ว่าเลือกอะไร กี่กรัม กี่ชิ้น — ที่เหลือเซิร์ฟเวอร์คิดเอง
--  (หลักการข้อ 5 เดียวกับที่ใช้กับจำนวนดวงของ QR โปรโมชั่น)
--
--  ส่วนลดปัดลงเป็นจำนวนเต็มบาทเสมอ เช่น 10% ของ 425 = 42.5 → ลดจริง 42 บาท
--  เพื่อไม่ให้เกิดเศษสตางค์ซึ่งเจ้าของไม่เอา และไม่ลดเกินเปอร์เซ็นต์ที่ประกาศ
-- ============================================================================

/** ส่วนลดที่ใช้ได้อยู่ ณ ตอนนี้ — ถ้ามีหลายตัวเอาตัวที่ลดเยอะสุด */
CREATE OR REPLACE FUNCTION delivery_live_discount()
RETURNS delivery_discounts AS $$
  SELECT * FROM delivery_discounts
   WHERE is_active AND now() >= starts_at AND now() < ends_at
   ORDER BY percent DESC, ends_at ASC
   LIMIT 1;
$$ LANGUAGE sql STABLE;


/** ราคาหมาล่าตามน้ำหนัก — ขีดละ 45 บาท อ่านค่าจาก app_settings */
CREATE OR REPLACE FUNCTION delivery_price_mala(p_grams int)
RETURNS int AS $$
  SELECT (p_grams / 100)
       * COALESCE((SELECT NULLIF(value,'null'::jsonb)::int
                     FROM app_settings WHERE key = 'delivery_price_per_100g'), 45);
$$ LANGUAGE sql STABLE;


-- ---------------------------------------------------------------------------
--  คิดบิลจากสิ่งที่ลูกค้าเลือก — ใช้ร่วมกันทั้งตอนดูราคาและตอนกดสั่งจริง
--  จะได้ไม่มีทางที่ "ราคาที่เห็น" กับ "ราคาที่เก็บเงิน" ต่างกัน
--
--  p_items ตัวอย่าง:
--  [{"kind":"mala","grams":500,"qty":1,"spicy":"เผ็ดกลาง","soup":"มาล่า",
--    "ingredients":["หมูสไลซ์","ลูกชิ้นปลา"]},
--   {"kind":"drink","item_id":"<uuid>","qty":2}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delivery_calc(p_zone_id uuid, p_items jsonb)
RETURNS jsonb AS $$
DECLARE
  v_zone   delivery_zones%ROWTYPE;
  v_min    int;
  v_step   int;
  v_it     jsonb;
  v_grams  int;
  v_qty    int;
  v_price  int;
  v_drink  delivery_menu_items%ROWTYPE;
  v_lines  jsonb := '[]'::jsonb;
  v_food   int := 0;
  v_disc   delivery_discounts%ROWTYPE;
  v_cut    int := 0;
  v_base   int;
BEGIN
  SELECT * INTO v_zone FROM delivery_zones WHERE id = p_zone_id AND is_active;
  IF v_zone.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'zone_not_found');
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_cart');
  END IF;

  SELECT COALESCE(NULLIF(value,'null'::jsonb)::int, 400) INTO v_min
    FROM app_settings WHERE key = 'delivery_min_grams';
  SELECT COALESCE(NULLIF(value,'null'::jsonb)::int, 100) INTO v_step
    FROM app_settings WHERE key = 'delivery_grams_step';

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(LEAST(COALESCE((v_it->>'qty')::int, 1), 10), 1);

    IF v_it->>'kind' = 'mala' THEN
      v_grams := (v_it->>'grams')::int;

      -- รับได้สองทาง: เป็นเซ็ตสำเร็จ หรือกำหนดเองที่ถึงขั้นต่ำและลงตัวตามขั้น
      IF NOT EXISTS (SELECT 1 FROM delivery_weight_presets
                      WHERE grams = v_grams AND is_active)
         AND NOT (v_grams >= v_min AND v_grams % v_step = 0) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'bad_weight',
                                  'grams', v_grams, 'min', v_min, 'step', v_step);
      END IF;

      v_price := delivery_price_mala(v_grams);
      v_food  := v_food + v_price * v_qty;

      v_lines := v_lines || jsonb_build_object(
        'kind','mala',
        'name','หมาล่า ' || v_grams::text || ' ก.',
        'grams', v_grams, 'qty', v_qty,
        'unit_price', v_price, 'total', v_price * v_qty,
        'spicy', v_it->>'spicy', 'soup', v_it->>'soup',
        -- กรองเฉพาะวัตถุดิบที่ยังเปิดอยู่จริง กันค่าแปลกปลอมจากฝั่งเบราว์เซอร์
        'ingredients', COALESCE((
          SELECT jsonb_agg(m.name ORDER BY m.sort)
            FROM delivery_menu_items m
           WHERE m.kind = 'ingredient' AND m.is_active
             AND m.name IN (SELECT jsonb_array_elements_text(
                              COALESCE(v_it->'ingredients','[]'::jsonb)))
        ), '[]'::jsonb)
      );

    ELSIF v_it->>'kind' = 'drink' THEN
      SELECT * INTO v_drink FROM delivery_menu_items
       WHERE id = (v_it->>'item_id')::uuid AND kind = 'drink' AND is_active;
      IF v_drink.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'drink_not_found');
      END IF;

      v_food := v_food + v_drink.price * v_qty;
      v_lines := v_lines || jsonb_build_object(
        'kind','drink', 'name', v_drink.name, 'grams', NULL, 'qty', v_qty,
        'unit_price', v_drink.price, 'total', v_drink.price * v_qty,
        'spicy', NULL, 'soup', NULL, 'ingredients', '[]'::jsonb
      );

    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_item_kind');
    END IF;
  END LOOP;

  -- ส่วนลดตามช่วงเวลา · ปัดลงเป็นจำนวนเต็มบาท
  v_disc := delivery_live_discount();
  IF v_disc.id IS NOT NULL THEN
    v_base := CASE WHEN v_disc.applies_to = 'grand' THEN v_food + v_zone.fee ELSE v_food END;
    IF v_disc.min_total IS NULL OR v_base >= v_disc.min_total THEN
      v_cut := (v_base * v_disc.percent) / 100;   -- หารจำนวนเต็ม = ปัดลงอยู่แล้ว
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'lines', v_lines,
    'zone', jsonb_build_object('id', v_zone.id, 'name', v_zone.name,
                               'note', v_zone.note, 'fee', v_zone.fee),
    'food_total',   v_food,
    'delivery_fee', v_zone.fee,
    'discount',     v_cut,
    'discount_info', CASE WHEN v_cut > 0 THEN jsonb_build_object(
                       'id', v_disc.id, 'name', v_disc.name,
                       'percent', v_disc.percent, 'ends_at', v_disc.ends_at)
                     ELSE NULL END,
    'grand_total',  v_food + v_zone.fee - v_cut
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 0025: ส่งเมนูแบบแบ่งหมวดให้หน้าสั่ง และรับเมนูจานเดียวเข้าตะกร้าได้
--
--  วัตถุดิบมี 59 รายการ ถ้าส่งเป็นลิสต์เดียวหน้าจอจะยาวจนเลื่อนหาไม่เจอ
--  จึงส่งเป็นหมวดมาให้เลย — หน้าเว็บแค่วาด ไม่ต้องมานั่งจัดกลุ่มเอง (หลักการข้อ 3)
-- ============================================================================

-- ───── ตัวคิดเงิน: รับ kind 'dish' เพิ่ม ─────
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
  v_menu   delivery_menu_items%ROWTYPE;
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
        'ingredients', COALESCE((
          SELECT jsonb_agg(m.name ORDER BY m.category, m.sort)
            FROM delivery_menu_items m
           WHERE m.kind = 'ingredient' AND m.is_active
             AND m.name IN (SELECT jsonb_array_elements_text(
                              COALESCE(v_it->'ingredients','[]'::jsonb)))
        ), '[]'::jsonb)
      );

    ELSIF v_it->>'kind' IN ('drink','dish') THEN
      SELECT * INTO v_menu FROM delivery_menu_items
       WHERE id = (v_it->>'item_id')::uuid
         AND kind = v_it->>'kind' AND is_active;
      IF v_menu.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found');
      END IF;

      v_food := v_food + v_menu.price * v_qty;
      v_lines := v_lines || jsonb_build_object(
        'kind', v_menu.kind, 'name', v_menu.name, 'grams', NULL, 'qty', v_qty,
        'unit_price', v_menu.price, 'total', v_menu.price * v_qty,
        'spicy', NULL, 'soup', NULL, 'ingredients', '[]'::jsonb
      );

    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_item_kind');
    END IF;
  END LOOP;

  v_disc := delivery_live_discount();
  IF v_disc.id IS NOT NULL THEN
    v_base := CASE WHEN v_disc.applies_to = 'grand' THEN v_food + v_zone.fee ELSE v_food END;
    IF v_disc.min_total IS NULL OR v_base >= v_disc.min_total THEN
      v_cut := (v_base * v_disc.percent) / 100;
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


-- ───── เมนูแบ่งหมวดให้หน้าจอ ─────
CREATE OR REPLACE FUNCTION api_delivery_menu(
  p_line_user_id text, p_name text, p_pic text
) RETURNS jsonb AS $$
DECLARE c customers; v_disc delivery_discounts%ROWTYPE; v_active jsonb;
BEGIN
  c := upsert_customer(p_line_user_id, p_name, p_pic);
  IF c.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_blocked');
  END IF;

  v_disc := delivery_live_discount();

  SELECT to_jsonb(x) INTO v_active FROM (
    SELECT o.id, o.order_no, o.status::text, o.grand_total, o.created_at,
           o.out_at, o.pay_method::text,
           o.slip_path IS NOT NULL AS has_slip, o.paid_at IS NOT NULL AS paid
      FROM delivery_orders o
     WHERE o.customer_id = c.id
       AND o.status IN ('placed','accepted','cooking','out')
     ORDER BY o.created_at DESC LIMIT 1
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'consented', c.consent_at IS NOT NULL,
    'enabled', COALESCE((SELECT value = 'true'::jsonb FROM app_settings WHERE key='delivery_enabled'), false),
    'open',    COALESCE((SELECT value = 'true'::jsonb FROM app_settings WHERE key='delivery_open'), false),
    'cod_allowed',      delivery_cod_allowed(c.id),
    'delivered_count',  delivery_completed_count(c.id),
    'cod_after_orders', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_cod_after_orders'), 1),
    'eta', jsonb_build_object(
      'min', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_eta_min'), 35),
      'max', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_eta_max'), 50)),
    'price_per_100g', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_price_per_100g'), 45),
    'min_grams',      COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_min_grams'), 400),
    'grams_step',     COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_grams_step'), 100),
    'presets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'grams', grams, 'price', delivery_price_mala(grams)) ORDER BY sort)
                FROM delivery_weight_presets WHERE is_active), '[]'::jsonb),
    'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', id, 'name', name, 'note', note, 'fee', fee) ORDER BY sort)
                FROM delivery_zones WHERE is_active), '[]'::jsonb),

    -- วัตถุดิบแบ่งหมวดมาให้เลย หน้าเว็บแค่วาด
    'ingredient_groups', COALESCE((
      SELECT jsonb_agg(g ORDER BY g->>'ord') FROM (
        SELECT jsonb_build_object(
          'category', category,
          'ord', min(CASE category
                       WHEN 'เนื้อสัตว์' THEN 1 WHEN 'ทะเล' THEN 2 WHEN 'ลูกชิ้น' THEN 3
                       WHEN 'ผัก' THEN 4 WHEN 'เห็ด' THEN 5 WHEN 'เส้น' THEN 6 ELSE 9 END),
          'items', jsonb_agg(jsonb_build_object('name', name, 'name_en', name_en) ORDER BY sort)
        ) AS g
        FROM delivery_menu_items
        WHERE kind='ingredient' AND is_active
        GROUP BY category
      ) t), '[]'::jsonb),

    'spicy', COALESCE((SELECT jsonb_agg(name ORDER BY sort)
                FROM delivery_menu_items WHERE kind='spicy' AND is_active), '[]'::jsonb),
    'soups', COALESCE((SELECT jsonb_agg(name ORDER BY sort)
                FROM delivery_menu_items WHERE kind='soup' AND is_active), '[]'::jsonb),
    'drinks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', id, 'name', name, 'name_en', name_en, 'price', price) ORDER BY sort)
                FROM delivery_menu_items WHERE kind='drink' AND is_active), '[]'::jsonb),
    'dishes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', id, 'name', name, 'name_en', name_en,
                  'price', price, 'note', note) ORDER BY sort)
                FROM delivery_menu_items WHERE kind='dish' AND is_active), '[]'::jsonb),

    'discount', CASE WHEN v_disc.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'name', v_disc.name, 'percent', v_disc.percent,
                  'applies_to', v_disc.applies_to, 'ends_at', v_disc.ends_at) END,
    'active_order', v_active
  );
END;
$$ LANGUAGE plpgsql;

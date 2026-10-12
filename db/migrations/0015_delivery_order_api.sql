-- ============================================================================
-- 0015: เดลิเวอรี่ — API ฝั่งลูกค้า (ดูเมนู · ดูราคา · กดสั่ง)
--
--  ทุกฟังก์ชันคืนทุกอย่างที่หน้าจอต้องใช้ในคำสั่งเดียว เพราะ Cloudflare Workers
--  เปิดตัวเชื่อมสองตัวในคำขอเดียวไม่ได้ (lib/db.ts)
-- ============================================================================

-- ---------------------------------------------------------------------------
--  หน้าแรกของ LIFF — ริชเมนูมีช่องเดียว หน้านี้จึงต้องตอบทั้ง
--  "มีออเดอร์ค้างอยู่ไหม" และ "จะสั่งอะไรได้บ้าง" ในครั้งเดียว
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_delivery_menu(
  p_line_user_id text, p_name text, p_pic text
) RETURNS jsonb AS $$
DECLARE
  c        customers;
  v_disc   delivery_discounts%ROWTYPE;
  v_active jsonb;
BEGIN
  c := upsert_customer(p_line_user_id, p_name, p_pic);
  IF c.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_blocked');
  END IF;

  v_disc := delivery_live_discount();

  -- ออเดอร์ที่ยังไม่ถึงมือ — เอาไปโชว์เป็นแถบบนสุดของหน้าแรก
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
    'ingredients', COALESCE((SELECT jsonb_agg(name ORDER BY sort)
                FROM delivery_menu_items WHERE kind='ingredient' AND is_active), '[]'::jsonb),
    'spicy', COALESCE((SELECT jsonb_agg(name ORDER BY sort)
                FROM delivery_menu_items WHERE kind='spicy' AND is_active), '[]'::jsonb),
    'soups', COALESCE((SELECT jsonb_agg(name ORDER BY sort)
                FROM delivery_menu_items WHERE kind='soup' AND is_active), '[]'::jsonb),
    'drinks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', id, 'name', name, 'price', price) ORDER BY sort)
                FROM delivery_menu_items WHERE kind='drink' AND is_active), '[]'::jsonb),
    'discount', CASE WHEN v_disc.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'name', v_disc.name, 'percent', v_disc.percent,
                  'applies_to', v_disc.applies_to, 'ends_at', v_disc.ends_at) END,
    'active_order', v_active
  );
END;
$$ LANGUAGE plpgsql;


/** ดูราคาก่อนกดสั่ง — ใช้ตัวคิดเงินตัวเดียวกับตอนสั่งจริง ราคาจึงตรงกันเสมอ */
CREATE OR REPLACE FUNCTION api_delivery_quote(p_zone_id uuid, p_items jsonb)
RETURNS jsonb AS $$
  SELECT delivery_calc(p_zone_id, p_items);
$$ LANGUAGE sql STABLE;


-- ---------------------------------------------------------------------------
--  กดสั่งจริง
--
--  ⚠️ คิดเงินใหม่ทั้งหมดตรงนี้ ไม่สนใจตัวเลขใด ๆ ที่เบราว์เซอร์ส่งมา
--  p_payload: {zone_id, address, phone, lat, lng, rider_note, pay_method, items}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_delivery_create(
  p_line_user_id text, p_name text, p_pic text, p_payload jsonb
) RETURNS jsonb AS $$
DECLARE
  c        customers;
  v_calc   jsonb;
  v_branch uuid;
  v_max    int;
  v_n      int;
  v_id     uuid;
  v_no     text;
  v_line   jsonb;
  v_pay    delivery_pay_method;
  v_phone  text := btrim(COALESCE(p_payload->>'phone',''));
  v_addr   text := btrim(COALESCE(p_payload->>'address',''));
BEGIN
  c := upsert_customer(p_line_user_id, p_name, p_pic);
  IF c.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_blocked');
  END IF;
  -- เก็บที่อยู่กับเบอร์โทรต้องมีการยินยอมก่อนเสมอ (PDPA)
  IF c.consent_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'need_consent');
  END IF;

  IF COALESCE((SELECT value FROM app_settings WHERE key='delivery_enabled'), 'false'::jsonb) <> 'true'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'delivery_disabled');
  END IF;
  IF COALESCE((SELECT value FROM app_settings WHERE key='delivery_open'), 'false'::jsonb) <> 'true'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed_now');
  END IF;

  IF v_addr = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'address_required'); END IF;
  IF v_phone = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'phone_required'); END IF;

  BEGIN
    v_pay := (p_payload->>'pay_method')::delivery_pay_method;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_pay_method');
  END;

  -- กันลูกค้าคนเดิมกดสั่งรัว ๆ ค้างไว้หลายใบ
  SELECT count(*)::int INTO v_n FROM delivery_orders
   WHERE customer_id = c.id AND status IN ('placed','accepted','cooking','out');
  IF v_n >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_open_orders');
  END IF;

  -- เพดานออเดอร์ที่ร้านรับพร้อมกันได้ · null = ไม่จำกัด
  SELECT NULLIF(value,'null'::jsonb)::int INTO v_max FROM app_settings WHERE key='delivery_max_active';
  IF v_max IS NOT NULL THEN
    SELECT count(*)::int INTO v_n FROM delivery_orders
     WHERE status IN ('placed','accepted','cooking','out');
    IF v_n >= v_max THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'shop_full');
    END IF;
  END IF;

  v_calc := delivery_calc((p_payload->>'zone_id')::uuid, p_payload->'items');
  IF (v_calc->>'ok')::boolean IS NOT TRUE THEN RETURN v_calc; END IF;

  SELECT COALESCE(z.branch_id,
           (SELECT id FROM branches WHERE is_active
             ORDER BY (code='main') DESC, created_at ASC LIMIT 1))
    INTO v_branch
    FROM delivery_zones z WHERE z.id = (p_payload->>'zone_id')::uuid;

  v_no := 'A-' || nextval('delivery_order_seq')::text;

  INSERT INTO delivery_orders (
    order_no, customer_id, branch_id, zone_id, address, phone, lat, lng, rider_note,
    food_total, delivery_fee, discount, grand_total, discount_id, pay_method
  ) VALUES (
    v_no, c.id, v_branch, (p_payload->>'zone_id')::uuid, v_addr, v_phone,
    NULLIF(p_payload->>'lat','')::numeric, NULLIF(p_payload->>'lng','')::numeric,
    NULLIF(btrim(COALESCE(p_payload->>'rider_note','')), ''),
    (v_calc->>'food_total')::int, (v_calc->>'delivery_fee')::int,
    (v_calc->>'discount')::int, (v_calc->>'grand_total')::int,
    (v_calc->'discount_info'->>'id')::uuid, v_pay
  ) RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_calc->'lines') LOOP
    INSERT INTO delivery_order_items (
      order_id, kind, name, grams, qty, unit_price, total, spicy, soup, ingredients
    ) VALUES (
      v_id, v_line->>'kind', v_line->>'name',
      NULLIF(v_line->>'grams','')::int, (v_line->>'qty')::int,
      (v_line->>'unit_price')::int, (v_line->>'total')::int,
      v_line->>'spicy', v_line->>'soup',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_line->'ingredients','[]'::jsonb)))
    );
  END LOOP;

  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('customer', NULL, 'delivery.order', v_no,
          jsonb_build_object('total', v_calc->>'grand_total', 'pay', v_pay));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'order_no', v_no,
                            'status', 'placed', 'pay_method', v_pay) || v_calc - 'ok';
END;
$$ LANGUAGE plpgsql;

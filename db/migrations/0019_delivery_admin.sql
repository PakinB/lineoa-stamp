-- ============================================================================
-- 0019: เดลิเวอรี่ — หน้าแอดมินของเจ้าของ
--
--  ทุกอย่างที่เจ้าของต้องแก้เองได้โดยไม่ต้อง deploy: โซนและค่าส่ง · เมนูวัตถุดิบ
--  และเครื่องดื่ม · ส่วนลดตามช่วงเวลา · ราคาต่อขีดและค่าตั้งอื่น
--
--  ใช้ฟังก์ชันบันทึกตัวเดียวแยกด้วย kind เพราะหนึ่งคำขอยิง SQL ได้คำสั่งเดียว
--  (lib/db.ts) การมีหลายฟังก์ชันไม่ช่วยอะไรนอกจากทำให้ route บวมขึ้น
-- ============================================================================

CREATE OR REPLACE FUNCTION api_admin_delivery()
RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'enabled',        COALESCE((SELECT value = 'true'::jsonb FROM app_settings WHERE key='delivery_enabled'), false),
      'open',           COALESCE((SELECT value = 'true'::jsonb FROM app_settings WHERE key='delivery_open'), false),
      'price_per_100g', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_price_per_100g'), 45),
      'min_grams',      COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_min_grams'), 400),
      'grams_step',     COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_grams_step'), 100),
      'eta_min',        COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_eta_min'), 35),
      'eta_max',        COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_eta_max'), 50),
      'max_active',     (SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_max_active'),
      'promptpay_set',  COALESCE((SELECT value <> 'null'::jsonb FROM app_settings WHERE key='promptpay_id'), false)),
    'zones', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'note', note, 'fee', fee, 'is_active', is_active) ORDER BY sort, name)
      FROM delivery_zones), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'kind', kind, 'name', name, 'price', price, 'is_active', is_active) ORDER BY kind, sort, name)
      FROM delivery_menu_items), '[]'::jsonb),
    'presets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'grams', grams, 'is_active', is_active) ORDER BY sort)
      FROM delivery_weight_presets), '[]'::jsonb),
    'discounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'percent', d.percent, 'applies_to', d.applies_to,
        'starts_at', d.starts_at, 'ends_at', d.ends_at, 'is_active', d.is_active,
        'live', d.is_active AND now() >= d.starts_at AND now() < d.ends_at,
        'used', (SELECT count(*)::int FROM delivery_orders o WHERE o.discount_id = d.id),
        'saved', (SELECT COALESCE(sum(o.discount),0)::int FROM delivery_orders o WHERE o.discount_id = d.id)
      ) ORDER BY d.ends_at DESC) FROM delivery_discounts d), '[]'::jsonb),
    'today', (SELECT jsonb_build_object(
        'orders',  count(*)::int,
        'sales',   COALESCE(sum(grand_total) FILTER (WHERE status='delivered'),0)::int,
        'cash',    COALESCE(sum(grand_total) FILTER (WHERE status='delivered' AND pay_method='cod'),0)::int,
        'transfer',COALESCE(sum(grand_total) FILTER (WHERE status='delivered' AND pay_method='transfer'),0)::int,
        'done',    count(*) FILTER (WHERE status='delivered')::int,
        'cancelled', count(*) FILTER (WHERE status='cancelled')::int)
      FROM delivery_orders
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')
  );
$$ LANGUAGE sql STABLE;


CREATE OR REPLACE FUNCTION api_admin_delivery_save(p_kind text, p_data jsonb, p_staff uuid)
RETURNS jsonb AS $$
DECLARE v_id uuid; v_name text := btrim(COALESCE(p_data->>'name',''));
BEGIN
  IF p_kind = 'setting' THEN
    UPDATE app_settings
       SET value = p_data->'value', updated_at = now(), updated_by = p_staff
     WHERE key = p_data->>'key'
       -- ล็อกไว้ให้แก้ได้เฉพาะค่าของเดลิเวอรี่ กันเผลอเขียนทับค่าอื่นของระบบ
       AND key IN ('delivery_enabled','delivery_open','delivery_price_per_100g',
                   'delivery_min_grams','delivery_grams_step','delivery_eta_min',
                   'delivery_eta_max','delivery_max_active','promptpay_id','shop_phone');
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'key_not_allowed'); END IF;

  ELSIF p_kind = 'zone' THEN
    IF v_name = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
    IF p_data->>'id' IS NULL THEN
      INSERT INTO delivery_zones (name, note, fee, sort)
      VALUES (v_name, NULLIF(btrim(COALESCE(p_data->>'note','')),''),
              GREATEST(COALESCE((p_data->>'fee')::int,0),0),
              COALESCE((SELECT max(sort)+1 FROM delivery_zones),1))
      RETURNING id INTO v_id;
    ELSE
      UPDATE delivery_zones
         SET name = v_name, note = NULLIF(btrim(COALESCE(p_data->>'note','')),''),
             fee = GREATEST(COALESCE((p_data->>'fee')::int, fee),0),
             is_active = COALESCE((p_data->>'is_active')::boolean, is_active)
       WHERE id = (p_data->>'id')::uuid RETURNING id INTO v_id;
      IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'zone_not_found'); END IF;
    END IF;

  ELSIF p_kind = 'item' THEN
    IF v_name = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
    IF p_data->>'id' IS NULL THEN
      INSERT INTO delivery_menu_items (kind, name, price, sort)
      VALUES (COALESCE(p_data->>'kind','ingredient'), v_name,
              GREATEST(COALESCE((p_data->>'price')::int,0),0),
              COALESCE((SELECT max(sort)+1 FROM delivery_menu_items
                         WHERE kind = COALESCE(p_data->>'kind','ingredient')),1))
      RETURNING id INTO v_id;
    ELSE
      UPDATE delivery_menu_items
         SET name = v_name, price = GREATEST(COALESCE((p_data->>'price')::int, price),0),
             is_active = COALESCE((p_data->>'is_active')::boolean, is_active)
       WHERE id = (p_data->>'id')::uuid RETURNING id INTO v_id;
      IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found'); END IF;
    END IF;

  ELSIF p_kind = 'discount' THEN
    IF p_data->>'id' IS NULL THEN
      IF v_name = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
      INSERT INTO delivery_discounts (name, percent, applies_to, starts_at, ends_at, created_by)
      VALUES (v_name,
              LEAST(GREATEST(COALESCE((p_data->>'percent')::int,10),1),100),
              CASE WHEN p_data->>'applies_to' = 'grand' THEN 'grand' ELSE 'food' END,
              COALESCE((p_data->>'starts_at')::timestamptz, now()),
              (p_data->>'ends_at')::timestamptz, p_staff)
      RETURNING id INTO v_id;
    ELSE
      -- แก้ได้แค่เปิด/ปิด · เปอร์เซ็นต์กับช่วงเวลาห้ามแก้ย้อนหลัง
      -- เพราะออเดอร์เก่าผูกส่วนลดตัวนี้ไว้ รายงานจะเพี้ยนถ้าตัวเลขเปลี่ยน
      UPDATE delivery_discounts
         SET is_active = COALESCE((p_data->>'is_active')::boolean, is_active)
       WHERE id = (p_data->>'id')::uuid RETURNING id INTO v_id;
      IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'discount_not_found'); END IF;
    END IF;

  ELSIF p_kind = 'preset' THEN
    INSERT INTO delivery_weight_presets (grams, sort)
    VALUES ((p_data->>'grams')::int, COALESCE((p_data->>'grams')::int / 100, 1))
    ON CONFLICT (grams) DO UPDATE
      SET is_active = COALESCE((p_data->>'is_active')::boolean, NOT delivery_weight_presets.is_active);

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_kind');
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('staff', p_staff, 'delivery.save.' || p_kind, COALESCE(v_id::text, p_data->>'key'), p_data);

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$ LANGUAGE plpgsql;

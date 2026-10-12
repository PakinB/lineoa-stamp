-- ============================================================================
-- 0016: เดลิเวอรี่ — ฝั่งพนักงาน และการปั๊มสแตมป์ตอนส่งถึง
--
--  ลำดับสถานะ: placed → accepted → cooking → out → delivered
--  ยกเลิกได้ทุกขั้นก่อน delivered
--
--  ⚠️ ออเดอร์ที่ "โอนเงิน" จะกดรับไม่ได้จนกว่าพนักงานจะยืนยันว่าเงินเข้าแล้ว
--  บังคับจากฐานข้อมูล ไม่ใช่ซ่อนปุ่มในหน้าเว็บ
-- ============================================================================

-- เบอร์พร้อมเพย์เก็บในฐานข้อมูล ไม่ฝังในโค้ด — เป็นเบอร์จริงของร้าน
-- ไม่ควรอยู่ในไฟล์ที่ commit ขึ้น GitHub และเจ้าของต้องแก้เองได้
INSERT INTO app_settings (key, value, description) VALUES
  ('promptpay_id', 'null', 'เบอร์โทรหรือเลขบัตรที่ผูกพร้อมเพย์ของร้าน — ใช้สร้าง QR ล็อคยอด'),
  ('shop_phone',   'null', 'เบอร์ร้านสำหรับปุ่ม "โทรหาร้าน" ในหน้าติดตามออเดอร์')
ON CONFLICT (key) DO NOTHING;


/** ย่อออเดอร์ให้อยู่ในรูปที่หน้าจอวาดได้เลย */
CREATE OR REPLACE FUNCTION delivery_order_json(o delivery_orders)
RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'id', o.id, 'order_no', o.order_no, 'status', o.status::text,
    'created_at', o.created_at, 'accepted_at', o.accepted_at,
    'cooking_at', o.cooking_at, 'out_at', o.out_at, 'delivered_at', o.delivered_at,
    'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason,
    'customer', COALESCE((SELECT display_name FROM customers WHERE id = o.customer_id), 'ลูกค้า'),
    'phone', o.phone, 'address', o.address, 'rider_note', o.rider_note,
    'lat', o.lat, 'lng', o.lng,
    'zone', (SELECT name || COALESCE(' · ' || note, '') FROM delivery_zones WHERE id = o.zone_id),
    'food_total', o.food_total, 'delivery_fee', o.delivery_fee,
    'discount', o.discount, 'grand_total', o.grand_total,
    'pay_method', o.pay_method::text,
    'has_slip', o.slip_path IS NOT NULL, 'slip_path', o.slip_path, 'slip_ref', o.slip_ref,
    'paid', o.paid_at IS NOT NULL, 'paid_at', o.paid_at,
    'rider', (SELECT name FROM staff_users WHERE id = o.rider_id),
    'stamped', o.stamp_id IS NOT NULL,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'total', i.total,
        'spicy', i.spicy, 'soup', i.soup,
        'ingredients', to_jsonb(COALESCE(i.ingredients, ARRAY[]::text[]))
      ) ORDER BY i.id) FROM delivery_order_items i WHERE i.order_id = o.id), '[]'::jsonb)
  );
$$ LANGUAGE sql STABLE;


-- ---------------------------------------------------------------------------
--  คิวออเดอร์ของพนักงาน — นับทุกแท็บมาในครั้งเดียว
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_staff_delivery_queue(p_branch_id uuid)
RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'open', COALESCE((SELECT value = 'true'::jsonb FROM app_settings WHERE key='delivery_open'), false),
    'counts', jsonb_build_object(
      'placed',   count(*) FILTER (WHERE o.status='placed')::int,
      'accepted', count(*) FILTER (WHERE o.status='accepted')::int,
      'cooking',  count(*) FILTER (WHERE o.status='cooking')::int,
      'out',      count(*) FILTER (WHERE o.status='out')::int),
    'orders', COALESCE(jsonb_agg(delivery_order_json(o.*)
                ORDER BY o.created_at) FILTER (WHERE o.status <> 'delivered'), '[]'::jsonb),
    'done_today', (SELECT count(*)::int FROM delivery_orders d
                    WHERE d.status='delivered'
                      AND (p_branch_id IS NULL OR d.branch_id = p_branch_id)
                      AND d.delivered_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')
  )
  FROM delivery_orders o
  WHERE (p_branch_id IS NULL OR o.branch_id = p_branch_id)
    AND o.status IN ('placed','accepted','cooking','out');
$$ LANGUAGE sql STABLE;


/** เปิด/ปิดรับออเดอร์ — ปุ่มที่ต้องกดได้ทันทีตอนครัวแน่น */
CREATE OR REPLACE FUNCTION api_staff_delivery_set_open(p_staff uuid, p_open boolean)
RETURNS jsonb AS $$
BEGIN
  UPDATE app_settings SET value = to_jsonb(p_open), updated_at = now(), updated_by = p_staff
   WHERE key = 'delivery_open';
  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('staff', p_staff, 'delivery.set_open', 'delivery_open', jsonb_build_object('open', p_open));
  RETURN jsonb_build_object('ok', true, 'open', p_open);
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  ลูกค้าแนบสลิป — เลขอ้างอิงจาก QR ท้ายสลิปกันส่งซ้ำ
--  unique index บน slip_ref ทำให้สลิปใบเดียวใช้ได้ออเดอร์เดียวตลอดกาล
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_delivery_attach_slip(
  p_line_user_id text, p_order_id uuid, p_path text, p_ref text
) RETURNS jsonb AS $$
DECLARE c customers; o delivery_orders%ROWTYPE; v_ref text := NULLIF(btrim(COALESCE(p_ref,'')), '');
BEGIN
  SELECT * INTO c FROM customers WHERE line_user_id = p_line_user_id;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;

  SELECT * INTO o FROM delivery_orders
   WHERE id = p_order_id AND customer_id = c.id FOR UPDATE;
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF o.paid_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_paid'); END IF;
  IF o.status NOT IN ('placed','accepted') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_late');
  END IF;

  IF v_ref IS NOT NULL AND EXISTS (
       SELECT 1 FROM delivery_orders WHERE slip_ref = v_ref AND id <> o.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slip_already_used');
  END IF;

  UPDATE delivery_orders SET slip_path = p_path, slip_ref = v_ref WHERE id = o.id;
  RETURN jsonb_build_object('ok', true, 'has_ref', v_ref IS NOT NULL);
END;
$$ LANGUAGE plpgsql;


/** พนักงานยืนยันว่าเงินเข้าจริง — ดูจากแอปธนาคาร ระบบแค่บันทึกว่าใครกด */
CREATE OR REPLACE FUNCTION api_staff_delivery_confirm_payment(
  p_order_id uuid, p_staff uuid, p_ok boolean, p_reason text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE o delivery_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM delivery_orders WHERE id = p_order_id FOR UPDATE;
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  IF p_ok THEN
    UPDATE delivery_orders SET paid_at = now(), paid_by = p_staff WHERE id = o.id;
  ELSE
    UPDATE delivery_orders
       SET status = 'cancelled', cancelled_at = now(),
           cancel_reason = COALESCE(p_reason, 'สลิปไม่ถูกต้อง')
     WHERE id = o.id;
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('staff', p_staff, 'delivery.payment', o.order_no, jsonb_build_object('ok', p_ok));

  RETURN jsonb_build_object('ok', true, 'order', delivery_order_json(
    (SELECT d FROM delivery_orders d WHERE d.id = o.id)));
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  เลื่อนสถานะ · ส่งถึงแล้วปั๊มสแตมป์ให้อัตโนมัติ
--
--  กุญแจกันซ้ำเป็น 'dorder:<id>' กดสองทียังได้ดวงเดียว
--  (หลักการข้อ 2 — ทุกทางเข้าต้องเรียก award_stamp ห้าม INSERT ลง ledger ตรง ๆ)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_staff_delivery_advance(
  p_order_id uuid, p_staff uuid, p_to text, p_rider uuid DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE o delivery_orders%ROWTYPE; v_res jsonb; v_stamp bigint;
BEGIN
  SELECT * INTO o FROM delivery_orders WHERE id = p_order_id FOR UPDATE;
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  IF p_to = 'cancelled' THEN
    IF o.status = 'delivered' THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_delivered'); END IF;
    UPDATE delivery_orders SET status='cancelled', cancelled_at=now(),
           cancel_reason = COALESCE(p_reason,'ร้านยกเลิก') WHERE id=o.id;

  ELSIF p_to = 'accepted' THEN
    IF o.status <> 'placed' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_transition'); END IF;
    -- โอนเงินมาแต่ยังไม่มีใครยืนยันว่าเงินเข้า = ห้ามรับออเดอร์
    IF o.pay_method = 'transfer' AND o.paid_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'payment_not_confirmed');
    END IF;
    UPDATE delivery_orders SET status='accepted', accepted_at=now(), accepted_by=p_staff WHERE id=o.id;

  ELSIF p_to = 'cooking' THEN
    IF o.status <> 'accepted' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_transition'); END IF;
    UPDATE delivery_orders SET status='cooking', cooking_at=now() WHERE id=o.id;

  ELSIF p_to = 'out' THEN
    IF o.status <> 'cooking' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_transition'); END IF;
    IF p_rider IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'rider_required'); END IF;
    UPDATE delivery_orders SET status='out', out_at=now(), rider_id=p_rider WHERE id=o.id;

  ELSIF p_to = 'delivered' THEN
    IF o.status <> 'out' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_transition'); END IF;

    v_res := award_stamp(
      p_customer_id     => o.customer_id,
      p_source          => 'delivery',
      p_idempotency_key => 'dorder:' || o.id::text,
      p_branch_id       => o.branch_id);
    v_stamp := (v_res->>'stamp_id')::bigint;

    UPDATE delivery_orders
       SET status='delivered', delivered_at=now(),
           rider_id = COALESCE(p_rider, rider_id),
           stamp_id = v_stamp,
           -- ปลายทางถือว่าเก็บเงินแล้วตอนปิดงาน
           paid_at = COALESCE(paid_at, CASE WHEN pay_method='cod' THEN now() END),
           paid_by = COALESCE(paid_by, CASE WHEN pay_method='cod' THEN p_staff END)
     WHERE id=o.id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_status');
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('staff', p_staff, 'delivery.' || p_to, o.order_no,
          jsonb_build_object('from', o.status::text));

  RETURN jsonb_build_object('ok', true,
    'stamp', CASE WHEN p_to='delivered' THEN v_res ELSE NULL END,
    'order', delivery_order_json((SELECT d FROM delivery_orders d WHERE d.id=o.id)));
END;
$$ LANGUAGE plpgsql;


/** ลูกค้าดูสถานะออเดอร์ของตัวเอง */
CREATE OR REPLACE FUNCTION api_delivery_my_order(p_line_user_id text, p_order_id uuid)
RETURNS jsonb AS $$
DECLARE c customers; o delivery_orders%ROWTYPE;
BEGIN
  SELECT * INTO c FROM customers WHERE line_user_id = p_line_user_id;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
  SELECT * INTO o FROM delivery_orders WHERE id = p_order_id AND customer_id = c.id;
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  RETURN jsonb_build_object('ok', true,
    'order', delivery_order_json(o) - 'phone' - 'slip_path',
    'shop_phone', (SELECT value #>> '{}' FROM app_settings WHERE key='shop_phone'),
    'eta_min', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_eta_min'), 35),
    'eta_max', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_eta_max'), 50));
END;
$$ LANGUAGE plpgsql;

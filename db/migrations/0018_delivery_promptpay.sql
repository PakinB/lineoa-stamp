-- ============================================================================
-- 0018: ส่งเบอร์พร้อมเพย์ไปให้หน้าจอลูกค้าสร้าง QR เอง
--
--  สร้าง QR ที่เครื่องลูกค้า ไม่ใช่ที่เซิร์ฟเวอร์ เพราะสายอักขระพร้อมเพย์เป็น
--  ข้อมูลสาธารณะ (ลูกค้าสแกนเห็นอยู่แล้ว) และทำให้ไม่ต้องส่งรูปภาพข้ามเน็ต
--  ตัวสร้างอยู่ที่ lib/promptpay.ts ซึ่งทดสอบ CRC16 กับค่าตรวจมาตรฐานแล้ว
-- ============================================================================

CREATE OR REPLACE FUNCTION api_delivery_my_order(p_line_user_id text, p_order_id uuid)
RETURNS jsonb AS $$
DECLARE c customers; o delivery_orders%ROWTYPE;
BEGIN
  SELECT * INTO c FROM customers WHERE line_user_id = p_line_user_id;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated'); END IF;
  SELECT * INTO o FROM delivery_orders WHERE id = p_order_id AND customer_id = c.id;
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  RETURN jsonb_build_object('ok', true,
    'order', delivery_order_json(o) - 'slip_path',
    -- ส่งไปเฉพาะตอนยังต้องจ่าย จะได้ไม่เผยเบอร์ร้านเกินจำเป็น
    'promptpay_id', CASE WHEN o.pay_method = 'transfer' AND o.paid_at IS NULL
                         THEN (SELECT value #>> '{}' FROM app_settings WHERE key='promptpay_id')
                    END,
    'shop_phone', (SELECT value #>> '{}' FROM app_settings WHERE key='shop_phone'),
    'eta_min', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_eta_min'), 35),
    'eta_max', COALESCE((SELECT NULLIF(value,'null'::jsonb)::int FROM app_settings WHERE key='delivery_eta_max'), 50));
END;
$$ LANGUAGE plpgsql;

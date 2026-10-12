-- ============================================================================
-- 0017: ที่เก็บรูปสลิป
--
--  เก็บลง Postgres โดยตั้งใจ "ชั่วคราว" — README วางแผนไว้ว่าจะใช้ bucket
--  receipts ของ Supabase แต่ต้องมี service key ซึ่งยังไม่ได้ตั้ง และ R2 ของ
--  Cloudflare ก็ต้องสร้าง bucket จากบัญชีจริงก่อน · เก็บในฐานข้อมูลไปก่อน
--  จะได้ไม่ต้องรอ แล้วย้ายทีหลังโดยไม่ต้องแก้หน้าจอ
--
--  คุมขนาดด้วยสองอย่าง
--   · ย่อรูปในมือถือลูกค้าก่อนอัปโหลด (เหลือราว 80 KB)
--   · CHECK จำกัดไม่เกิน 200 KB ต่อใบ ป้องกันคนยัดไฟล์ใหญ่
--   · ลบรูปที่ปิดงานแล้วเกิน 90 วัน — ลบได้เพราะตัวที่กันสลิปซ้ำคือ slip_ref
--     ที่เก็บแยกอยู่บน delivery_orders ไม่ใช่ตัวรูป
--
--  แยกตารางออกมาเพื่อให้ delivery_orders ยังเบาเวลา query คิวออเดอร์
-- ============================================================================

CREATE TABLE delivery_slips (
  order_id   uuid PRIMARY KEY REFERENCES delivery_orders(id) ON DELETE CASCADE,
  mime       text NOT NULL DEFAULT 'image/jpeg',
  bytes      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slip_size_cap CHECK (octet_length(bytes) <= 200 * 1024)
);

COMMENT ON TABLE delivery_slips IS
  'รูปสลิปโอนเงิน · ย้ายไป object storage ได้โดยไม่กระทบหน้าจอ เพราะเข้าถึงผ่าน API เส้นเดียว';


/** ลบรูปสลิปเก่าที่ปิดงานแล้ว — เรียกจากงานตามเวลาหรือกดเองจากหน้าแอดมิน */
CREATE OR REPLACE FUNCTION api_admin_purge_old_slips(p_days int DEFAULT 90)
RETURNS jsonb AS $$
DECLARE v_n int;
BEGIN
  DELETE FROM delivery_slips s
   USING delivery_orders o
   WHERE o.id = s.order_id
     AND o.status IN ('delivered','cancelled')
     AND o.created_at < now() - make_interval(days => GREATEST(p_days, 7));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', v_n);
END;
$$ LANGUAGE plpgsql;


/**
 * ลูกค้าแนบสลิป — รับรูปเป็น base64 แล้วเก็บเป็นไบต์
 * เขียนรูปกับอัปเดตออเดอร์ในฟังก์ชันเดียว เพราะหนึ่งคำขอยิง SQL ได้คำสั่งเดียว
 */
CREATE OR REPLACE FUNCTION api_delivery_upload_slip(
  p_line_user_id text, p_order_id uuid, p_b64 text, p_mime text, p_ref text
) RETURNS jsonb AS $$
DECLARE
  c customers; o delivery_orders%ROWTYPE;
  v_ref text := NULLIF(btrim(COALESCE(p_ref,'')), '');
  v_bytes bytea;
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

  -- เลขอ้างอิงจาก QR ท้ายสลิป ใช้ได้ครั้งเดียวตลอดกาล
  IF v_ref IS NOT NULL AND EXISTS (
       SELECT 1 FROM delivery_orders WHERE slip_ref = v_ref AND id <> o.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slip_already_used');
  END IF;

  BEGIN
    v_bytes := decode(p_b64, 'base64');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_image');
  END;

  IF octet_length(v_bytes) > 200 * 1024 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'image_too_big');
  END IF;

  INSERT INTO delivery_slips (order_id, mime, bytes)
  VALUES (o.id, COALESCE(NULLIF(p_mime,''),'image/jpeg'), v_bytes)
  ON CONFLICT (order_id) DO UPDATE SET bytes = EXCLUDED.bytes, mime = EXCLUDED.mime, created_at = now();

  UPDATE delivery_orders
     SET slip_path = 'db:' || o.id::text, slip_ref = v_ref
   WHERE id = o.id;

  RETURN jsonb_build_object('ok', true, 'has_ref', v_ref IS NOT NULL,
                            'size_kb', round(octet_length(v_bytes) / 1024.0));
END;
$$ LANGUAGE plpgsql;


/** พนักงานเปิดดูรูปสลิป — คืน base64 ให้หน้าเว็บวาด */
CREATE OR REPLACE FUNCTION api_staff_delivery_slip(p_order_id uuid)
RETURNS jsonb AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('ok', true, 'mime', mime,
            'b64', encode(bytes, 'base64'),
            'ref', (SELECT slip_ref FROM delivery_orders WHERE id = p_order_id))
       FROM delivery_slips WHERE order_id = p_order_id),
    jsonb_build_object('ok', false, 'reason', 'slip_not_found'));
$$ LANGUAGE sql STABLE;

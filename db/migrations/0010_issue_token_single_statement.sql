-- ============================================================================
-- 0010: ให้ "ออก QR โปรโมชั่น" ยิง SQL คำสั่งเดียว
--
--  บั๊กที่เจอตอนทำรอบโปรโมชั่น: route ออก QR อ่าน promo_points ด้วย
--  getSetting() ก่อน แล้วค่อยเรียก api_issue_token อีกคำสั่ง = สองคำสั่งต่อคำขอ
--
--  บน Cloudflare Workers lib/db.ts เปิดตัวเชื่อมใหม่ทุกครั้งที่เรียก sql``
--  สองคำสั่งจึงเท่ากับสองตัวเชื่อมในคำขอเดียว ซึ่งล้มเหลวราว 7 ใน 10 ครั้ง
--  อาการคือ "กดออก QR แล้วค้างไม่ตอบ" โดยไม่มี error ให้อ่าน
--  (เส้น QR ธรรมดายิงคำสั่งเดียวอยู่แล้ว จึงไม่เคยมีอาการ — โดนแค่ปุ่มโปรโมชั่น)
--
--  แก้โดยย้ายการอ่าน promo_points เข้ามาในฟังก์ชัน แล้วให้ route ส่งแค่
--  ธงว่า "ใบนี้เป็นโปรโมชั่นไหม" ได้ผลพลอยได้คือตรงกับหลักการข้อ 5 ด้วย:
--  จำนวนดวงถูกตัดสินฝั่งเซิร์ฟเวอร์ทั้งหมด ฝั่งเบราว์เซอร์ส่งตัวเลขมาไม่ได้เลย
-- ============================================================================

-- ต้องทิ้งตัวที่รับ int ก่อน ไม่งั้นการเรียกด้วย 5 อาร์กิวเมนต์จะกำกวม
-- (บทเรียนเดิมจาก 0007 — Postgres เลือกฟังก์ชันไม่ถูกแล้ว error ตอนรันไทม์)
DROP FUNCTION IF EXISTS api_issue_token(uuid, uuid, text, text, int);

CREATE OR REPLACE FUNCTION api_issue_token(
  p_branch_id uuid, p_staff_id uuid, p_code text, p_order_ref text,
  p_promo boolean DEFAULT false
) RETURNS jsonb AS $$
DECLARE
  v_ttl    int;
  v_exp    timestamptz;
  v_branch uuid := p_branch_id;
  v_pts    int  := 1;
  v_round  int;
BEGIN
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches WHERE is_active
     ORDER BY (code = 'main') DESC, created_at ASC LIMIT 1;
  END IF;

  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 10) INTO v_ttl
    FROM app_settings WHERE key = 'token_ttl_minutes';
  v_exp := now() + make_interval(mins => COALESCE(v_ttl, 10));

  IF p_promo IS TRUE THEN
    -- เพดาน 1–10 ซ้ำกับ CHECK constraint บนตาราง เผื่อค่าในตั้งค่าเพี้ยน
    SELECT LEAST(GREATEST(COALESCE(NULLIF(value, 'null'::jsonb)::int, 3), 1), 10)
      INTO v_pts FROM app_settings WHERE key = 'promo_points';
    v_pts := COALESCE(v_pts, 3);

    SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 1) INTO v_round
      FROM app_settings WHERE key = 'promo_round';
    v_round := COALESCE(v_round, 1);
  END IF;

  INSERT INTO earn_tokens (code, branch_id, order_ref, issued_by, expires_at, points, promo_round)
  VALUES (p_code, v_branch, p_order_ref, p_staff_id, v_exp, v_pts, v_round);

  RETURN jsonb_build_object('ok', true, 'code', p_code,
                            'expires_at', v_exp, 'points', v_pts,
                            'promo_round', v_round);
END;
$$ LANGUAGE plpgsql;

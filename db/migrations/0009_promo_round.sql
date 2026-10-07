-- ============================================================================
-- 0009: รอบโปรโมชั่น — ลูกค้าหนึ่งคนรับ QR โปรโมชั่นได้ครั้งเดียวต่อรอบ
--
--  เดิมกันแค่ "หนึ่ง QR ใช้ได้คนเดียว" ซึ่งทำงานถูกอยู่แล้ว (ล็อกแถวใน
--  claim_earn_token) แต่ลูกค้าคนเดิมยังรับโปรโมชั่นซ้ำจาก QR คนละใบได้
--  — เกิดขึ้นจริงไปแล้วในข้อมูล production
--
--  กติกาที่เจ้าของเคาะ: โปรโมชั่นหนึ่งรอบ ลูกค้าหนึ่งคนร่วมได้ครั้งเดียว
--  จัดโปรฯ ใหม่ให้กดขึ้นรอบใหม่ที่หน้าแอดมิน แล้วทุกคนรับได้อีกครั้ง
--
--  เลือกเก็บเลขรอบไว้บนตัว earn_tokens ไม่ใช่ตารางแยก เพราะ "ใครรับโปรฯ
--  รอบไหนไปแล้ว" คือข้อเท็จจริงที่ token บอกได้อยู่แล้ว การแยกตารางจะทำให้
--  มีความจริงสองที่ที่ต้องคอยให้ตรงกัน
-- ============================================================================

-- รอบปัจจุบัน · เพิ่มทีละหนึ่งผ่านปุ่มที่หน้าแอดมิน ไม่ได้ให้พิมพ์เอง
INSERT INTO app_settings (key, value, description) VALUES
  ('promo_round', '1',
   'รอบโปรโมชั่นปัจจุบัน — ลูกค้าหนึ่งคนรับ QR โปรโมชั่นได้ครั้งเดียวต่อรอบ')
ON CONFLICT (key) DO NOTHING;

-- NULL = QR ธรรมดา ไม่เกี่ยวกับโปรโมชั่น
ALTER TABLE earn_tokens ADD COLUMN IF NOT EXISTS promo_round int;

COMMENT ON COLUMN earn_tokens.promo_round IS
  'รอบโปรโมชั่นที่ QR ใบนี้สังกัด · null = QR สะสมปกติ';

-- QR โปรโมชั่นที่ออกไปก่อนมีคอลัมน์นี้ นับเป็นรอบที่ 1 ทั้งหมด
-- คนที่เคยรับไปแล้วจึงต้องรอรอบใหม่ ตรงกับเจตนาของกติกา
UPDATE earn_tokens SET promo_round = 1 WHERE points > 1 AND promo_round IS NULL;

-- ใช้ตอนเช็คสิทธิ์ทุกครั้งที่มีคนสแกน QR โปรโมชั่น ต้องเร็ว
CREATE INDEX IF NOT EXISTS ix_token_promo_claimed
  ON earn_tokens (consumed_by, promo_round)
  WHERE status = 'consumed' AND promo_round IS NOT NULL;


-- ---------------------------------------------------------------------------
--  ออก QR — ติดเลขรอบปัจจุบันไปกับใบโปรโมชั่น
--
--  ติดตอน "ออก" ไม่ใช่ตอน "สแกน" เพราะถ้าเจ้าของกดขึ้นรอบใหม่ระหว่างที่
--  QR ใบเก่ายังไม่หมดอายุ ใบนั้นควรยังเป็นของรอบที่ออกมันมา
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_issue_token(
  p_branch_id uuid, p_staff_id uuid, p_code text, p_order_ref text,
  p_points int DEFAULT 1
) RETURNS jsonb AS $$
DECLARE
  v_ttl int;
  v_exp timestamptz;
  v_branch uuid := p_branch_id;
  v_pts int := LEAST(GREATEST(COALESCE(p_points, 1), 1), 10);
  v_round int;
BEGIN
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches WHERE is_active
     ORDER BY (code = 'main') DESC, created_at ASC LIMIT 1;
  END IF;

  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 10) INTO v_ttl
    FROM app_settings WHERE key = 'token_ttl_minutes';
  v_exp := now() + make_interval(mins => COALESCE(v_ttl, 10));

  IF v_pts > 1 THEN
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


-- ---------------------------------------------------------------------------
--  เคลม QR — เช็คสิทธิ์โปรโมชั่น "ก่อน" จะกินรหัส
--
--  **ลำดับสำคัญมาก** ของเดิมใช้ UPDATE...WHERE status='active' เป็นทั้งตัวล็อก
--  และตัวกิน ถ้าทำแบบนั้นต่อ คนที่เคยรับโปรฯ ไปแล้วเผลอสแกนจะกิน QR ทิ้ง
--  ทั้งที่ตัวเองไม่ได้ดวง แล้วลูกค้าที่ควรได้จะสแกนไม่ได้
--
--  จึงเปลี่ยนเป็น SELECT ... FOR UPDATE ล็อกแถวไว้ก่อน เช็คให้ผ่าน แล้วค่อย
--  UPDATE · ปลอดภัยเท่าเดิมเพราะทั้งหมดอยู่ในฟังก์ชันเดียว = ทรานแซกชันเดียว
--  และ FOR UPDATE ทำให้คำขอที่สองรอจนคำขอแรกจบ แล้วเห็นว่าแถวไม่ active แล้ว
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_earn_token(
  p_customer_id uuid,
  p_code        text
) RETURNS jsonb AS $$
DECLARE v_token earn_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_token FROM earn_tokens
   WHERE code = p_code
     AND status = 'active'
     AND (expires_at IS NULL OR expires_at > now())
   FOR UPDATE;

  IF v_token.id IS NULL THEN
    -- แยกเคส "คุณเองสแกนไปแล้ว" เพื่อไม่ให้ลูกค้าตกใจว่าแต้มหาย
    IF EXISTS (SELECT 1 FROM earn_tokens
                WHERE code = p_code AND consumed_by = p_customer_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed_by_you',
                                'card', get_card_state(p_customer_id));
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  END IF;

  -- หนึ่งคนต่อหนึ่งรอบ · ไม่กิน QR ทิ้ง ลูกค้าคนที่ควรได้ยังสแกนใบนี้ได้อยู่
  IF v_token.promo_round IS NOT NULL
     AND EXISTS (SELECT 1 FROM earn_tokens
                  WHERE consumed_by = p_customer_id
                    AND status = 'consumed'
                    AND promo_round = v_token.promo_round) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'promo_already_claimed',
                              'card', get_card_state(p_customer_id));
  END IF;

  UPDATE earn_tokens
     SET status = 'consumed', consumed_at = now(), consumed_by = p_customer_id
   WHERE id = v_token.id;

  RETURN award_stamps(
    p_customer_id => p_customer_id,
    p_source      => 'qr',
    p_key_prefix  => 'token:' || p_code,
    p_count       => COALESCE(v_token.points, 1),
    p_branch_id   => v_token.branch_id
  );
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  หน้าแอดมิน: ดูรอบปัจจุบัน และกดขึ้นรอบใหม่
-- ---------------------------------------------------------------------------

-- เติมข้อมูลรอบโปรโมชั่นเข้าไปในชุดตั้งค่าที่หน้าแอดมินโหลดอยู่แล้ว
-- จะได้ไม่ต้องยิงคำขอที่สอง (Workers เปิดตัวเชื่อมสองตัวต่อคำขอไม่ได้)
CREATE OR REPLACE FUNCTION api_admin_get_settings()
RETURNS jsonb AS $$
DECLARE
  v_settings jsonb;
  v_round    int;
  v_claimed  int;
  v_issued   int;
BEGIN
  SELECT COALESCE(jsonb_object_agg(key, jsonb_build_object(
           'value', value, 'description', description, 'updated_at', updated_at)), '{}'::jsonb)
    INTO v_settings FROM app_settings;

  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 1) INTO v_round
    FROM app_settings WHERE key = 'promo_round';
  v_round := COALESCE(v_round, 1);

  SELECT count(*) FILTER (WHERE status = 'consumed')::int, count(*)::int
    INTO v_claimed, v_issued
    FROM earn_tokens WHERE promo_round = v_round;

  RETURN jsonb_build_object('ok', true, 'settings', v_settings,
    'promo', jsonb_build_object('round', v_round, 'claimed', v_claimed, 'issued', v_issued));
END;
$$ LANGUAGE plpgsql STABLE;


-- เพิ่มทีละหนึ่งในคำสั่งเดียว กันสองคนกดพร้อมกันแล้วข้ามเลข
CREATE OR REPLACE FUNCTION api_admin_start_promo_round(p_staff uuid)
RETURNS jsonb AS $$
DECLARE v_new int;
BEGIN
  UPDATE app_settings
     SET value = to_jsonb(COALESCE(NULLIF(value, 'null'::jsonb)::int, 1) + 1),
         updated_at = now(), updated_by = p_staff
   WHERE key = 'promo_round'
  RETURNING value::int INTO v_new;

  IF v_new IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'key_not_found');
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('staff', p_staff, 'promo.new_round', 'promo_round',
          jsonb_build_object('new_round', v_new));

  RETURN jsonb_build_object('ok', true, 'round', v_new, 'claimed', 0, 'issued', 0);
END;
$$ LANGUAGE plpgsql;

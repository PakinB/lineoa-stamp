-- ============================================================================
--  QR โปรโมชั่น — ปั๊มหลายดวงในการสแกนครั้งเดียว
--
--  ใช้ตอนจัดโปรโมชั่น พนักงานกดปุ่ม "โปรโมชั่น" แล้วออก QR ที่ให้ 3 ดวง
--  เมื่อลูกค้าทำเงื่อนไขหน้างานครบแล้ว
--
--  ยังใช้กลไกเดิมทุกอย่าง: รหัสใช้ได้ครั้งเดียว ล็อกแถวตอนเคลม
--  ต่างแค่ปั๊มลง ledger หลายแถวแทนแถวเดียว
-- ============================================================================

ALTER TABLE earn_tokens
  ADD COLUMN IF NOT EXISTS points int NOT NULL DEFAULT 1;

-- กันตั้งค่าเพี้ยน เช่น 0 ดวง หรือมากเกินจนบัตรเต็มรวดเดียวหลายใบ
ALTER TABLE earn_tokens DROP CONSTRAINT IF EXISTS earn_token_points_range;
ALTER TABLE earn_tokens
  ADD CONSTRAINT earn_token_points_range CHECK (points BETWEEN 1 AND 10);

COMMENT ON COLUMN earn_tokens.points IS
  'จำนวนดวงที่ QR ใบนี้ให้ · ปกติ 1 · QR โปรโมชั่นมากกว่านั้น';


/**
 * ปั๊มหลายดวงติดกัน
 *
 * เรียก award_stamp ทีละดวง เพราะตรรกะการข้าม checkpoint และการปิดบัตร
 * แล้วเปิดใบใหม่อยู่ในนั้นแล้ว วนเรียกจึงได้พฤติกรรมถูกต้องอัตโนมัติ
 * แม้ 3 ดวงนั้นจะพาดผ่าน checkpoint หรือทำให้บัตรเต็มพอดี
 *
 * กุญแจกันซ้ำต่อท้ายด้วยลำดับ (token:CODE:1, :2, :3) ยิงซ้ำทั้งชุดจึงไม่ปั๊มเพิ่ม
 */
CREATE OR REPLACE FUNCTION award_stamps(
  p_customer_id     uuid,
  p_source          stamp_source,
  p_key_prefix      text,
  p_count           int,
  p_branch_id       uuid DEFAULT NULL,
  p_note            text DEFAULT NULL,
  p_created_by      uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_res   jsonb;
  v_ents  jsonb := '[]'::jsonb;
  v_first int;
  v_last  int;
  v_full  boolean := false;
  i       int;
BEGIN
  FOR i IN 1..GREATEST(p_count, 1) LOOP
    v_res := award_stamp(
      p_customer_id     => p_customer_id,
      p_source          => p_source,
      p_idempotency_key => p_key_prefix || ':' || i,
      p_branch_id       => p_branch_id,
      p_note            => p_note,
      p_created_by      => p_created_by
    );

    IF (v_res->>'ok')::boolean IS NOT TRUE THEN
      RETURN v_res;   -- ล้มกลางคัน คืนผลตามจริง ดวงที่ปั๊มไปแล้วยังอยู่
    END IF;

    IF v_first IS NULL THEN v_first := (v_res->>'stamped_slot')::int; END IF;
    v_last := (v_res->>'stamped_slot')::int;
    v_ents := v_ents || COALESCE(v_res->'new_entitlements', '[]'::jsonb);
    IF (v_res->>'card_completed')::boolean THEN v_full := true; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'awarded', GREATEST(p_count, 1),
    -- หน้าเว็บเล่นอนิเมชั่นจากช่องแรกถึงช่องสุดท้ายที่เพิ่งปั๊ม
    'stamped_slot', v_last,
    'stamped_from', v_first,
    'card_completed', v_full,
    'new_entitlements', v_ents,
    'card', get_card_state(p_customer_id)
  );
END;
$$ LANGUAGE plpgsql;


-- เคลม QR โดยดูจำนวนดวงจากตัว token
CREATE OR REPLACE FUNCTION claim_earn_token(
  p_customer_id uuid,
  p_code        text
) RETURNS jsonb AS $$
DECLARE v_token earn_tokens%ROWTYPE;
BEGIN
  UPDATE earn_tokens
     SET status = 'consumed', consumed_at = now(), consumed_by = p_customer_id
   WHERE code = p_code
     AND status = 'active'
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING * INTO v_token;

  IF v_token.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM earn_tokens
                WHERE code = p_code AND consumed_by = p_customer_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed_by_you',
                                'card', get_card_state(p_customer_id));
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  END IF;

  RETURN award_stamps(
    p_customer_id => p_customer_id,
    p_source      => 'qr',
    p_key_prefix  => 'token:' || p_code,
    p_count       => COALESCE(v_token.points, 1),
    p_branch_id   => v_token.branch_id
  );
END;
$$ LANGUAGE plpgsql;


-- ออก QR โดยระบุจำนวนดวงได้
--
-- ต้องลบตัว 4 พารามิเตอร์ของเดิมทิ้งก่อน ไม่งั้นจะมีสองตัวซ้อนกัน
-- แล้วการเรียกด้วย 4 อาร์กิวเมนต์จะกำกวมจน Postgres เลือกไม่ถูก
-- (ตัวใหม่มีค่าเริ่มต้นให้พารามิเตอร์ที่ห้า จึงรับ 4 อาร์กิวเมนต์ได้เหมือนกัน)
DROP FUNCTION IF EXISTS api_issue_token(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION api_issue_token(
  p_branch_id uuid, p_staff_id uuid, p_code text, p_order_ref text,
  p_points int DEFAULT 1
) RETURNS jsonb AS $$
DECLARE
  v_ttl int;
  v_exp timestamptz;
  v_branch uuid := p_branch_id;
  v_pts int := LEAST(GREATEST(COALESCE(p_points, 1), 1), 10);
BEGIN
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches WHERE is_active
     ORDER BY (code = 'main') DESC, created_at ASC LIMIT 1;
  END IF;

  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 10) INTO v_ttl
    FROM app_settings WHERE key = 'token_ttl_minutes';
  v_exp := now() + make_interval(mins => COALESCE(v_ttl, 10));

  INSERT INTO earn_tokens (code, branch_id, order_ref, issued_by, expires_at, points)
  VALUES (p_code, v_branch, p_order_ref, p_staff_id, v_exp, v_pts);

  RETURN jsonb_build_object('ok', true, 'code', p_code,
                            'expires_at', v_exp, 'points', v_pts);
END;
$$ LANGUAGE plpgsql;


-- ค่าตั้งต้นจำนวนดวงของปุ่มโปรโมชั่น แก้ได้จากหน้าแอดมิน
INSERT INTO app_settings (key, value, description) VALUES
  ('promo_points', '3', 'จำนวนดวงที่ QR โปรโมชั่นให้ต่อการสแกนหนึ่งครั้ง')
ON CONFLICT (key) DO NOTHING;

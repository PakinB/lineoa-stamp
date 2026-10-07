-- ============================================================================
-- 0011: โปรโมชั่นหลายตัว — เจ้าของสร้างเองได้จากหน้าแอดมิน
--
--  แทนที่แนวคิด "รอบโปรโมชั่น" ของ 0009 ด้วยตัวโปรโมชั่นจริง ๆ
--  เพราะเจ้าของต้องการตั้งชื่อ กำหนดดวง และเลือกว่าลูกค้าร่วมได้ครั้งเดียว
--  หรือหลายครั้ง แยกกันในแต่ละตัว — เลขรอบตัวเดียวทั้งระบบทำแบบนั้นไม่ได้
--
--  "ขึ้นรอบใหม่" กลายเป็น "สร้างโปรโมชั่นตัวใหม่" ซึ่งตรงกับสิ่งที่ร้านทำจริง
--  มากกว่า และเก็บประวัติแยกเป็นตัว ๆ ได้ว่าโปรฯ ไหนคนร่วมเยอะ
--
--  **ย้ายข้อมูลเดิมครบก่อนค่อยทิ้งของเก่า** promo_round ทุกแถวถูกแปลงเป็น
--  campaign_id ของโปรโมชั่นตัวแรก แล้วค่อย DROP คอลัมน์ทิ้ง เพื่อไม่ให้มี
--  ความจริงสองที่ที่ต้องคอยให้ตรงกัน
-- ============================================================================

CREATE TABLE IF NOT EXISTS promo_campaigns (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  -- ดวงที่ให้ต่อการสแกนหนึ่งครั้ง · เพดานเท่ากับ earn_tokens.points
  points    int  NOT NULL DEFAULT 3 CHECK (points BETWEEN 1 AND 10),
  -- true = ลูกค้าหนึ่งคนร่วมโปรฯ ตัวนี้ได้ครั้งเดียว · false = กี่ครั้งก็ได้
  once_per_customer boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  note      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES staff_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- กันตั้งชื่อซ้ำเฉพาะตัวที่เปิดอยู่ ไม่งั้นพนักงานเห็นปุ่มสองปุ่มชื่อเหมือนกัน
-- ตัวที่ปิดแล้วชื่อซ้ำได้ เพราะเป็นประวัติ
CREATE UNIQUE INDEX IF NOT EXISTS ux_promo_active_name
  ON promo_campaigns (name) WHERE is_active;

COMMENT ON TABLE promo_campaigns IS
  'โปรโมชั่นที่เจ้าของสร้างเอง · QR แต่ละใบผูกกับตัวใดตัวหนึ่งผ่าน earn_tokens.campaign_id';

ALTER TABLE earn_tokens
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES promo_campaigns(id);

COMMENT ON COLUMN earn_tokens.campaign_id IS
  'โปรโมชั่นที่ QR ใบนี้สังกัด · null = QR สะสมปกติ';

-- ใช้ตอนเช็คสิทธิ์ทุกครั้งที่มีคนสแกน QR โปรโมชั่น ต้องเร็ว
CREATE INDEX IF NOT EXISTS ix_token_campaign_claimed
  ON earn_tokens (consumed_by, campaign_id)
  WHERE status = 'consumed' AND campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_token_campaign
  ON earn_tokens (campaign_id) WHERE campaign_id IS NOT NULL;


-- ---------------------------------------------------------------------------
--  ย้ายข้อมูลเดิม: QR โปรโมชั่นที่ออกไปแล้วทั้งหมดสังกัดโปรฯ ตัวแรก
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_id uuid; v_pts int;
BEGIN
  IF EXISTS (SELECT 1 FROM promo_campaigns) THEN RETURN; END IF;

  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 3) INTO v_pts
    FROM app_settings WHERE key = 'promo_points';

  INSERT INTO promo_campaigns (name, points, once_per_customer, note)
  VALUES ('โปรโมชั่นตัวแรก', LEAST(GREATEST(COALESCE(v_pts, 3), 1), 10), true,
          'ย้ายมาจากระบบรอบโปรโมชั่นเดิมโดยอัตโนมัติ — เปลี่ยนชื่อได้')
  RETURNING id INTO v_id;

  UPDATE earn_tokens SET campaign_id = v_id WHERE points > 1 AND campaign_id IS NULL;
END $$;

-- ข้อมูลถูกย้ายครบแล้ว คอลัมน์เดิมไม่เหลือข้อมูลที่ campaign_id บอกไม่ได้
ALTER TABLE earn_tokens DROP COLUMN IF EXISTS promo_round;

-- ค่าสองตัวนี้ย้ายไปอยู่บนตัวโปรโมชั่นแต่ละตัวแล้ว เก็บไว้จะกลายเป็นค่าที่
-- เจ้าของแก้แล้วไม่มีผล ซึ่งแย่กว่าไม่มีช่องให้แก้
DELETE FROM app_settings WHERE key IN ('promo_round', 'promo_points');
DROP FUNCTION IF EXISTS api_admin_start_promo_round(uuid);


-- ---------------------------------------------------------------------------
--  ออก QR — ส่ง id ของโปรโมชั่นมา ถ้าไม่ส่งคือ QR สะสมปกติ
--
--  จำนวนดวงอ่านจากตัวโปรโมชั่นฝั่งฐานข้อมูลเสมอ ฝั่งเบราว์เซอร์ส่งเลขดวง
--  มาไม่ได้เลยแม้แต่ทางเดียว (หลักการข้อ 5) และยังเป็น SQL คำสั่งเดียว
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api_issue_token(uuid, uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION api_issue_token(
  p_branch_id uuid, p_staff_id uuid, p_code text, p_order_ref text,
  p_campaign_id uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_ttl    int;
  v_exp    timestamptz;
  v_branch uuid := p_branch_id;
  v_pts    int  := 1;
  v_camp   promo_campaigns%ROWTYPE;
BEGIN
  IF p_campaign_id IS NOT NULL THEN
    SELECT * INTO v_camp FROM promo_campaigns WHERE id = p_campaign_id;
    IF v_camp.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'promo_not_found');
    END IF;
    IF NOT v_camp.is_active THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'promo_inactive');
    END IF;
    v_pts := v_camp.points;
  END IF;

  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches WHERE is_active
     ORDER BY (code = 'main') DESC, created_at ASC LIMIT 1;
  END IF;

  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 10) INTO v_ttl
    FROM app_settings WHERE key = 'token_ttl_minutes';
  v_exp := now() + make_interval(mins => COALESCE(v_ttl, 10));

  INSERT INTO earn_tokens (code, branch_id, order_ref, issued_by, expires_at, points, campaign_id)
  VALUES (p_code, v_branch, p_order_ref, p_staff_id, v_exp, v_pts, v_camp.id);

  RETURN jsonb_build_object('ok', true, 'code', p_code, 'expires_at', v_exp,
                            'points', v_pts, 'promo_name', v_camp.name,
                            'once_per_customer', v_camp.once_per_customer);
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  เคลม QR — กติกา "ครั้งเดียว" อ่านจากตัวโปรโมชั่น ไม่ใช่ค่ากลางของระบบ
--
--  ⚠️ ลำดับห้ามเปลี่ยน: SELECT FOR UPDATE -> เช็คสิทธิ์ -> UPDATE
--  ถ้ากลับไปใช้ UPDATE ... WHERE status='active' เป็นตัวล็อก คนที่หมดสิทธิ์
--  แล้วเผลอสแกนจะกิน QR ทิ้งทั้งที่ตัวเองไม่ได้ดวง ลูกค้าที่ควรได้จะสแกนไม่ได้
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_earn_token(
  p_customer_id uuid,
  p_code        text
) RETURNS jsonb AS $$
DECLARE
  v_token earn_tokens%ROWTYPE;
  v_once  boolean;
BEGIN
  SELECT * INTO v_token FROM earn_tokens
   WHERE code = p_code
     AND status = 'active'
     AND (expires_at IS NULL OR expires_at > now())
   FOR UPDATE;

  IF v_token.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM earn_tokens
                WHERE code = p_code AND consumed_by = p_customer_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed_by_you',
                                'card', get_card_state(p_customer_id));
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  END IF;

  IF v_token.campaign_id IS NOT NULL THEN
    SELECT once_per_customer INTO v_once
      FROM promo_campaigns WHERE id = v_token.campaign_id;

    IF v_once AND EXISTS (SELECT 1 FROM earn_tokens
                           WHERE consumed_by = p_customer_id
                             AND status = 'consumed'
                             AND campaign_id = v_token.campaign_id) THEN
      -- ไม่กิน QR ทิ้ง ลูกค้าคนที่ควรได้ยังสแกนใบนี้ได้อยู่
      RETURN jsonb_build_object('ok', false, 'reason', 'promo_already_claimed',
                                'card', get_card_state(p_customer_id));
    END IF;
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
--  หน้าแอดมิน: รายการโปรโมชั่นพร้อมสถิติ
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_admin_promo_campaigns()
RETURNS jsonb AS $$
  SELECT jsonb_build_object('ok', true, 'campaigns', COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'points', c.points,
    'once_per_customer', c.once_per_customer, 'is_active', c.is_active,
    'note', c.note, 'created_at', c.created_at,
    'issued', s.issued, 'claimed', s.claimed, 'customers', s.customers, 'stamps', s.stamps
  ) ORDER BY c.is_active DESC, c.created_at DESC), '[]'::jsonb))
  FROM promo_campaigns c
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS issued,
           count(*) FILTER (WHERE t.status = 'consumed')::int AS claimed,
           count(DISTINCT t.consumed_by)::int AS customers,
           COALESCE(sum(t.points) FILTER (WHERE t.status = 'consumed'), 0)::int AS stamps
      FROM earn_tokens t WHERE t.campaign_id = c.id
  ) s ON true;
$$ LANGUAGE sql STABLE;


-- สร้างหรือแก้ไขในฟังก์ชันเดียว — p_id เป็น null คือสร้างใหม่
CREATE OR REPLACE FUNCTION api_admin_save_promo_campaign(
  p_id uuid, p_name text, p_points int, p_once boolean, p_active boolean, p_staff uuid
) RETURNS jsonb AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_pts  int  := LEAST(GREATEST(COALESCE(p_points, 3), 1), 10);
  v_id   uuid;
BEGIN
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_required');
  END IF;

  IF EXISTS (SELECT 1 FROM promo_campaigns
              WHERE name = v_name AND is_active AND COALESCE(p_active, true)
                AND (p_id IS NULL OR id <> p_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_taken');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO promo_campaigns (name, points, once_per_customer, is_active, created_by)
    VALUES (v_name, v_pts, COALESCE(p_once, true), COALESCE(p_active, true), p_staff)
    RETURNING id INTO v_id;
  ELSE
    UPDATE promo_campaigns
       SET name = v_name, points = v_pts,
           once_per_customer = COALESCE(p_once, once_per_customer),
           is_active = COALESCE(p_active, is_active),
           updated_at = now()
     WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'promo_not_found');
    END IF;
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('staff', p_staff, CASE WHEN p_id IS NULL THEN 'promo.create' ELSE 'promo.update' END,
          v_id::text, jsonb_build_object('name', v_name, 'points', v_pts,
                                         'once_per_customer', p_once, 'is_active', p_active));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$ LANGUAGE plpgsql;


-- หน้าพนักงาน: เฉพาะตัวที่เปิดอยู่ เรียงตัวใหม่ไว้บน
CREATE OR REPLACE FUNCTION api_staff_promo_campaigns()
RETURNS jsonb AS $$
  SELECT jsonb_build_object('ok', true, 'campaigns', COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'points', points, 'once_per_customer', once_per_customer
  ) ORDER BY created_at DESC), '[]'::jsonb))
  FROM promo_campaigns WHERE is_active;
$$ LANGUAGE sql STABLE;


-- เอาข้อมูลรอบโปรโมชั่นออกจากชุดตั้งค่า — ย้ายไปอยู่หน้าโปรโมชั่นแล้ว
CREATE OR REPLACE FUNCTION api_admin_get_settings()
RETURNS jsonb AS $$
  SELECT jsonb_build_object('ok', true, 'settings',
    COALESCE(jsonb_object_agg(key, jsonb_build_object(
      'value', value, 'description', description, 'updated_at', updated_at)), '{}'::jsonb))
  FROM app_settings;
$$ LANGUAGE sql STABLE;

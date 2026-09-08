-- ============================================================================
--  ฟังก์ชันทางเข้าระดับ API — หนึ่งคำขอ = หนึ่งคำสั่ง SQL
--
--  เหตุผล (ดู lib/db.ts): Cloudflare Workers ผูก I/O ไว้กับคำขอที่สร้างมัน
--  การเปิดตัวเชื่อมสองตัวในคำขอเดียวล้มเหลวราว 7 ใน 10 ครั้ง
--  จึงรวมทุกอย่างที่คำขอหนึ่งต้องทำไว้ในคำสั่งเดียว
--
--  ผลพลอยได้: ลดรอบสื่อสารกับฐานข้อมูลลงครึ่งหนึ่งในทุกเส้นทางของลูกค้า
--  ซึ่งสำคัญเพราะลูกค้ายืนรออยู่หน้าเคาน์เตอร์ตอนสแกน
-- ============================================================================

-- ลูกค้าเกิดอัตโนมัติตอนเรียกครั้งแรก ไม่มีขั้นตอนสมัคร (§4)
CREATE OR REPLACE FUNCTION upsert_customer(
  p_line_user_id text, p_name text, p_pic text
) RETURNS customers AS $$
  INSERT INTO customers (line_user_id, display_name, picture_url)
  VALUES (p_line_user_id, p_name, p_pic)
  ON CONFLICT (line_user_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, customers.display_name),
        picture_url  = COALESCE(EXCLUDED.picture_url,  customers.picture_url)
  RETURNING *;
$$ LANGUAGE sql;


CREATE OR REPLACE FUNCTION api_get_card(
  p_line_user_id text, p_name text, p_pic text
) RETURNS jsonb AS $$
DECLARE c customers;
BEGIN
  c := upsert_customer(p_line_user_id, p_name, p_pic);
  IF c.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_blocked');
  END IF;
  RETURN jsonb_build_object('ok', true, 'consented', c.consent_at IS NOT NULL)
         || get_card_state(c.id);
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION api_consent(
  p_line_user_id text, p_name text, p_pic text
) RETURNS jsonb AS $$
DECLARE c customers;
BEGIN
  c := upsert_customer(p_line_user_id, p_name, p_pic);
  UPDATE customers SET consent_at = COALESCE(consent_at, now()) WHERE id = c.id;
  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;


/**
 * สแกน QR สะสมแต้ม
 *
 * เพดานอ่านจาก app_settings — ค่า null แปลว่าไม่จำกัด ต้องรองรับให้ถูก
 * ปัจจุบันเปิดไม่จำกัดทั้งคู่ (§6) เพราะทุกดวงต้องมีพนักงานกดออก QR
 * จากบิลจริงอยู่แล้ว จึงจำกัดตัวเองในตัว
 */
CREATE OR REPLACE FUNCTION api_claim_token(
  p_line_user_id text, p_name text, p_pic text, p_code text
) RETURNS jsonb AS $$
DECLARE
  c        customers;
  v_branch uuid;
  v_day    int;
  v_cool   int;
  v_n      int;
BEGIN
  c := upsert_customer(p_line_user_id, p_name, p_pic);
  IF c.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_blocked');
  END IF;

  SELECT branch_id INTO v_branch FROM earn_tokens WHERE code = p_code;

  SELECT NULLIF(value, 'null'::jsonb)::int INTO v_day
    FROM app_settings WHERE key = 'max_stamps_per_day';
  IF v_day IS NOT NULL THEN
    SELECT count(*)::int INTO v_n FROM stamp_ledger
     WHERE customer_id = c.id
       AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                         AT TIME ZONE 'Asia/Bangkok';
    IF v_n >= v_day THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
    END IF;
  END IF;

  SELECT NULLIF(value, 'null'::jsonb)::int INTO v_cool
    FROM app_settings WHERE key = 'cooldown_minutes';
  IF v_cool IS NOT NULL AND v_branch IS NOT NULL THEN
    SELECT count(*)::int INTO v_n FROM stamp_ledger
     WHERE customer_id = c.id AND branch_id = v_branch
       AND created_at > now() - make_interval(mins => v_cool);
    IF v_n > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
    END IF;
  END IF;

  RETURN claim_earn_token(c.id, p_code);
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION api_list_redeemable(
  p_line_user_id text, p_name text, p_pic text, p_code text
) RETURNS jsonb AS $$
DECLARE c customers;
BEGIN
  c := upsert_customer(p_line_user_id, p_name, p_pic);
  RETURN list_redeemable(c.id, p_code);
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION api_redeem(
  p_line_user_id text, p_name text, p_pic text,
  p_code text, p_entitlement_id uuid, p_option_id uuid
) RETURNS jsonb AS $$
DECLARE c customers;
BEGIN
  c := upsert_customer(p_line_user_id, p_name, p_pic);
  RETURN redeem_with_token(c.id, p_code, p_entitlement_id, p_option_id);
END;
$$ LANGUAGE plpgsql;


-- พนักงานกดออก QR — อ่านอายุจากค่าตั้งค่าแล้วบันทึกในคำสั่งเดียว
CREATE OR REPLACE FUNCTION api_issue_token(
  p_branch_id uuid, p_staff_id uuid, p_code text, p_order_ref text
) RETURNS jsonb AS $$
DECLARE v_ttl int; v_exp timestamptz;
BEGIN
  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 10) INTO v_ttl
    FROM app_settings WHERE key = 'token_ttl_minutes';
  v_exp := now() + make_interval(mins => COALESCE(v_ttl, 10));

  INSERT INTO earn_tokens (code, branch_id, order_ref, issued_by, expires_at)
  VALUES (p_code, p_branch_id, p_order_ref, p_staff_id, v_exp);

  RETURN jsonb_build_object('ok', true, 'code', p_code, 'expires_at', v_exp);
END;
$$ LANGUAGE plpgsql;


-- สรุปกะ — รวมสองคำถามเป็นคำสั่งเดียว
CREATE OR REPLACE FUNCTION api_shift_summary(p_branch_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                         AT TIME ZONE 'Asia/Bangkok';
  v_issued int; v_claimed int; v_rewards jsonb;
BEGIN
  SELECT count(*)::int, count(*) FILTER (WHERE status = 'consumed')::int
    INTO v_issued, v_claimed
    FROM earn_tokens WHERE branch_id = p_branch_id AND issued_at >= v_start;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'n', n) ORDER BY n DESC), '[]'::jsonb)
    INTO v_rewards
    FROM (SELECT o.name, count(*)::int AS n
            FROM entitlements e JOIN reward_options o ON o.id = e.chosen_option_id
           WHERE e.status = 'used' AND e.used_branch_id = p_branch_id
             AND e.used_at >= v_start
           GROUP BY o.name) t;

  RETURN jsonb_build_object('ok', true,
    'qr_issued', v_issued, 'qr_claimed', v_claimed,
    'qr_unclaimed', v_issued - v_claimed, 'rewards_given', v_rewards);
END;
$$ LANGUAGE plpgsql;

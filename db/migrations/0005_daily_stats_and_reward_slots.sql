-- ============================================================================
--  0005: ปรับปรุงการออก QR สำหรับแอดมิน / สถิติรายวัน Excel / จัดการรางวัล 1-10
-- ============================================================================

-- 1) ให้ api_issue_token รองรับกรณี p_branch_id เป็น NULL (กรณีเจ้าของร้านล็อกอิน)
CREATE OR REPLACE FUNCTION api_issue_token(
  p_branch_id uuid, p_staff_id uuid, p_code text, p_order_ref text
) RETURNS jsonb AS $$
DECLARE
  v_ttl int;
  v_exp timestamptz;
  v_branch uuid := p_branch_id;
BEGIN
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches WHERE is_active ORDER BY (code = 'main') DESC, created_at ASC LIMIT 1;
  END IF;

  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 10) INTO v_ttl
    FROM app_settings WHERE key = 'token_ttl_minutes';
  v_exp := now() + make_interval(mins => COALESCE(v_ttl, 10));

  INSERT INTO earn_tokens (code, branch_id, order_ref, issued_by, expires_at)
  VALUES (p_code, v_branch, p_order_ref, p_staff_id, v_exp);

  RETURN jsonb_build_object('ok', true, 'code', p_code, 'expires_at', v_exp);
END;
$$ LANGUAGE plpgsql;


-- 2) ให้ issue_redeem_token รองรับกรณี p_branch_id เป็น NULL
CREATE OR REPLACE FUNCTION issue_redeem_token(
  p_branch_id uuid,
  p_staff_id  uuid,
  p_code      text
) RETURNS jsonb AS $$
DECLARE
  v_ttl int;
  v_branch uuid := p_branch_id;
BEGIN
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches WHERE is_active ORDER BY (code = 'main') DESC, created_at ASC LIMIT 1;
  END IF;

  SELECT COALESCE((value->>'redeem_token_ttl_minutes')::int, 5) INTO v_ttl
    FROM app_settings WHERE key = 'redeem_token_ttl_minutes';

  INSERT INTO redeem_tokens (code, branch_id, issued_by, expires_at)
  VALUES (p_code, v_branch, p_staff_id,
          now() + make_interval(mins => COALESCE(v_ttl, 5)));

  RETURN jsonb_build_object('ok', true, 'code', p_code,
    'expires_at', now() + make_interval(mins => COALESCE(v_ttl, 5)));
END;
$$ LANGUAGE plpgsql;


-- 3) ให้ api_shift_summary รองรับกรณี p_branch_id เป็น NULL
CREATE OR REPLACE FUNCTION api_shift_summary(p_branch_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                         AT TIME ZONE 'Asia/Bangkok';
  v_issued int; v_claimed int; v_rewards jsonb;
  v_branch uuid := p_branch_id;
BEGIN
  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM branches WHERE is_active ORDER BY (code = 'main') DESC, created_at ASC LIMIT 1;
  END IF;

  SELECT count(*)::int, count(*) FILTER (WHERE status = 'consumed')::int
    INTO v_issued, v_claimed
    FROM earn_tokens WHERE branch_id = v_branch AND issued_at >= v_start;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'n', n) ORDER BY n DESC), '[]'::jsonb)
    INTO v_rewards
    FROM (SELECT o.name, count(*)::int AS n
            FROM entitlements e JOIN reward_options o ON o.id = e.chosen_option_id
           WHERE e.status = 'used' AND e.used_branch_id = v_branch
             AND e.used_at >= v_start
           GROUP BY o.name) t;

  RETURN jsonb_build_object('ok', true,
    'qr_issued', v_issued, 'qr_claimed', v_claimed,
    'qr_unclaimed', v_issued - v_claimed, 'rewards_given', v_rewards);
END;
$$ LANGUAGE plpgsql;


-- 4) ปรับปรุง api_admin_stats ให้มี daily_stats สำหรับสรุปรายวันและ Export Excel
CREATE OR REPLACE FUNCTION api_admin_stats()
RETURNS jsonb AS $$
DECLARE
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok';
  v_stamps_today int;
  v_stamps_all   int;
  v_cust_all     int;
  v_rew_today    int;
  v_rew_all      int;
  v_rew_pending  int;
  v_tokens_today int;
  v_tokens_used  int;
  v_recent       jsonb;
  v_daily        jsonb;
BEGIN
  SELECT count(*)::int INTO v_stamps_today FROM stamp_ledger WHERE created_at >= v_today_start;
  SELECT count(*)::int INTO v_stamps_all   FROM stamp_ledger;
  SELECT count(*)::int INTO v_cust_all     FROM customers;
  SELECT count(*)::int INTO v_rew_today    FROM entitlements WHERE status = 'used' AND used_at >= v_today_start;
  SELECT count(*)::int INTO v_rew_all      FROM entitlements WHERE status = 'used';
  SELECT count(*)::int INTO v_rew_pending  FROM entitlements WHERE status = 'available';

  SELECT count(*)::int, count(*) FILTER (WHERE status = 'consumed')::int
    INTO v_tokens_today, v_tokens_used
    FROM earn_tokens WHERE issued_at >= v_today_start;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'slot_no', l.slot_no,
    'source', l.source,
    'customer_name', COALESCE(c.display_name, 'ลูกค้า'),
    'branch_name', COALESCE(b.name, 'ไม่ระบุสาขา'),
    'created_at', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (SELECT * FROM stamp_ledger ORDER BY created_at DESC LIMIT 15) l
  JOIN customers c ON c.id = l.customer_id
  LEFT JOIN branches b ON b.id = l.branch_id;

  -- สรุปรายวันสำหรับ QR
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(d.day, 'YYYY-MM-DD'),
    'date_th', to_char(d.day, 'DD/MM/YYYY'),
    'issued', d.issued,
    'claimed', d.claimed,
    'unclaimed', d.unclaimed,
    'rate', d.rate
  ) ORDER BY d.day DESC), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      date_trunc('day', issued_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
      count(*)::int AS issued,
      count(*) FILTER (WHERE status = 'consumed')::int AS claimed,
      (count(*) - count(*) FILTER (WHERE status = 'consumed'))::int AS unclaimed,
      CASE WHEN count(*) > 0
        THEN round((count(*) FILTER (WHERE status = 'consumed')::numeric / count(*)::numeric) * 100, 1)
        ELSE 0
      END AS rate
    FROM earn_tokens
    GROUP BY date_trunc('day', issued_at AT TIME ZONE 'Asia/Bangkok')::date
  ) d;

  RETURN jsonb_build_object(
    'ok', true,
    'stamps_today', v_stamps_today,
    'stamps_all', v_stamps_all,
    'customers_all', v_cust_all,
    'rewards_today', v_rew_today,
    'rewards_all', v_rew_all,
    'rewards_pending', v_rew_pending,
    'tokens_today', v_tokens_today,
    'tokens_used', v_tokens_used,
    'recent_activity', v_recent,
    'daily_stats', v_daily
  );
END;
$$ LANGUAGE plpgsql STABLE;


-- 5) ดึงข้อมูลของรางวัลช่อง 1 ถึง 10
CREATE OR REPLACE FUNCTION api_admin_get_rewards()
RETURNS jsonb AS $$
DECLARE
  v_slots jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'slot_no', g.n,
    'checkpoint_id', c.id,
    'label', COALESCE(CASE WHEN c.is_active THEN c.label ELSE '' END, ''),
    'is_active', COALESCE(c.is_active, false)
  ) ORDER BY g.n)
  INTO v_slots
  FROM generate_series(1, 10) AS g(n)
  LEFT JOIN reward_checkpoints c ON c.slot_no = g.n;

  RETURN jsonb_build_object('ok', true, 'slots', v_slots);
END;
$$ LANGUAGE plpgsql STABLE;


-- 6) บันทึกของรางวัลช่องเดียว
CREATE OR REPLACE FUNCTION api_admin_update_slot_reward(
  p_slot_no int,
  p_label text
) RETURNS jsonb AS $$
DECLARE
  v_trim text := trim(COALESCE(p_label, ''));
  v_cp reward_checkpoints%ROWTYPE;
  v_opt reward_options%ROWTYPE;
BEGIN
  IF v_trim = '' THEN
    UPDATE reward_checkpoints
       SET is_active = false, label = ''
     WHERE slot_no = p_slot_no
    RETURNING * INTO v_cp;

    IF v_cp.id IS NOT NULL THEN
      UPDATE reward_options SET is_active = false WHERE checkpoint_id = v_cp.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'slot_no', p_slot_no, 'label', '', 'is_active', false);
  ELSE
    INSERT INTO reward_checkpoints (slot_no, label, is_active)
    VALUES (p_slot_no, v_trim, true)
    ON CONFLICT (slot_no) DO UPDATE
      SET label = EXCLUDED.label,
          is_active = true
    RETURNING * INTO v_cp;

    SELECT * INTO v_opt FROM reward_options
     WHERE checkpoint_id = v_cp.id
     ORDER BY sort ASC LIMIT 1;

    IF v_opt.id IS NOT NULL THEN
      UPDATE reward_options
         SET name = v_trim, is_active = true
       WHERE id = v_opt.id;
    ELSE
      INSERT INTO reward_options (checkpoint_id, name, sort, is_active)
      VALUES (v_cp.id, v_trim, 1, true);
    END IF;

    RETURN jsonb_build_object('ok', true, 'slot_no', p_slot_no, 'label', v_trim, 'is_active', true);
  END IF;
END;
$$ LANGUAGE plpgsql;


-- 7) บันทึกของรางวัลทั้ง 1-10 ช่องในคำสั่งเดียว
CREATE OR REPLACE FUNCTION api_admin_save_all_rewards(p_slots text)
RETURNS jsonb AS $$
DECLARE
  elem jsonb;
  v_slot int;
  v_label text;
BEGIN
  FOR elem IN SELECT * FROM jsonb_array_elements(p_slots::jsonb)
  LOOP
    v_slot := (elem->>'slot_no')::int;
    v_label := elem->>'label';
    IF v_slot >= 1 AND v_slot <= 10 THEN
      PERFORM api_admin_update_slot_reward(v_slot, v_label);
    END IF;
  END LOOP;

  RETURN api_admin_get_rewards();
END;
$$ LANGUAGE plpgsql;

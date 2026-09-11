-- ============================================================================
--  0004: ระบบจัดการพนักงาน และหน้าแอดมิน
--
--  1. เพิ่มฟิลด์ป้องกันการเดา PIN (failed_attempts, locked_until) บน staff_users
--  2. เพิ่มค่าตั้งค่าเวลาเข้ากะ (11:00-22:00) และการล็อกบัญชีลง app_settings
--  3. ฟังก์ชัน API สำหรับการเข้ากะและการจัดการในหน้าแอดมิน
-- ============================================================================

-- 1) เพิ่มคอลัมน์กันเดา PIN บน staff_users
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- 2) ค่าตั้งค่าเวลาทำงานและจำกัดการเดา PIN
INSERT INTO app_settings (key, value, description) VALUES
  ('shift_start_hour',    '11', 'เวลาเริ่มเข้ากะของพนักงาน (น.)'),
  ('shift_end_hour',      '22', 'เวลาสิ้นสุดการเข้ากะของพนักงาน (น.)'),
  ('pin_max_attempts',    '5',  'จำนวนครั้งสูงสุดที่เดา PIN ผิดก่อนล็อกบัญชี'),
  ('pin_lockout_minutes', '15', 'ระยะเวลาล็อกบัญชีเมื่อใส่ PIN ผิดเกินกำหนด (นาที)')
ON CONFLICT (key) DO NOTHING;

-- 3) ดึงรายชื่อพนักงานสำหรับหน้าจอเข้ากะ (เลือกชื่อ -> ใส่ PIN)
CREATE OR REPLACE FUNCTION api_staff_list_for_login()
RETURNS jsonb AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'role', s.role,
    'branch_id', s.branch_id,
    'branch_name', COALESCE(b.name, 'ทุกสาขา'),
    'is_locked', (s.locked_until IS NOT NULL AND s.locked_until > now()),
    'locked_until', s.locked_until
  ) ORDER BY s.role = 'owner' DESC, s.name ASC), '[]'::jsonb)
  FROM staff_users s
  LEFT JOIN branches b ON b.id = s.branch_id
  WHERE s.revoked_at IS NULL;
$$ LANGUAGE sql STABLE;

-- 4) ข้อมูลพนักงานสำหรับการตรวจสอบสิทธิ์เข้ากะ
CREATE OR REPLACE FUNCTION api_staff_auth_info(p_staff_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_staff   staff_users%ROWTYPE;
  v_start   int;
  v_end     int;
  v_max_att int;
  v_lock_m  int;
  v_bkk_now timestamptz := now() AT TIME ZONE 'Asia/Bangkok';
  v_bkk_hr  int := EXTRACT(HOUR FROM v_bkk_now)::int;
  v_bkk_min int := EXTRACT(MINUTE FROM v_bkk_now)::int;
BEGIN
  SELECT * INTO v_staff FROM staff_users
   WHERE id = p_staff_id AND revoked_at IS NULL;

  IF v_staff.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staff_not_found');
  END IF;

  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 11) INTO v_start
    FROM app_settings WHERE key = 'shift_start_hour';
  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 22) INTO v_end
    FROM app_settings WHERE key = 'shift_end_hour';
  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 5) INTO v_max_att
    FROM app_settings WHERE key = 'pin_max_attempts';
  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 15) INTO v_lock_m
    FROM app_settings WHERE key = 'pin_lockout_minutes';

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_staff.id,
    'name', v_staff.name,
    'role', v_staff.role,
    'branch_id', v_staff.branch_id,
    'pin_hash', v_staff.pin_hash,
    'failed_attempts', v_staff.failed_attempts,
    'locked_until', v_staff.locked_until,
    'is_locked', (v_staff.locked_until IS NOT NULL AND v_staff.locked_until > now()),
    'shift_start', v_start,
    'shift_end', v_end,
    'bkk_hour', v_bkk_hr,
    'bkk_minute', v_bkk_min,
    'is_working_hours', (v_bkk_hr >= v_start AND (v_bkk_hr < v_end OR (v_bkk_hr = v_end AND v_bkk_min = 0))),
    'max_attempts', v_max_att,
    'lockout_minutes', v_lock_m
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- 5) บันทึกเมื่อใส่ PIN ผิด
CREATE OR REPLACE FUNCTION api_staff_record_login_failure(p_staff_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_max_att int;
  v_lock_m  int;
  v_staff   staff_users%ROWTYPE;
  v_new_att int;
  v_lock_to timestamptz := NULL;
BEGIN
  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 5) INTO v_max_att
    FROM app_settings WHERE key = 'pin_max_attempts';
  SELECT COALESCE(NULLIF(value, 'null'::jsonb)::int, 15) INTO v_lock_m
    FROM app_settings WHERE key = 'pin_lockout_minutes';

  SELECT * INTO v_staff FROM staff_users WHERE id = p_staff_id;
  IF v_staff.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staff_not_found');
  END IF;

  v_new_att := v_staff.failed_attempts + 1;
  IF v_new_att >= v_max_att THEN
    v_lock_to := now() + make_interval(mins => v_lock_m);
  END IF;

  UPDATE staff_users
     SET failed_attempts = v_new_att,
         locked_until    = COALESCE(v_lock_to, locked_until)
   WHERE id = p_staff_id;

  RETURN jsonb_build_object(
    'ok', true,
    'failed_attempts', v_new_att,
    'attempts_left', GREATEST(0, v_max_att - v_new_att),
    'is_locked', (v_lock_to IS NOT NULL),
    'locked_until', v_lock_to
  );
END;
$$ LANGUAGE plpgsql;

-- 6) บันทึกเมื่อล็อกอินสำเร็จ (รีเซ็ต failed_attempts)
CREATE OR REPLACE FUNCTION api_staff_record_login_success(p_staff_id uuid)
RETURNS jsonb AS $$
BEGIN
  UPDATE staff_users
     SET failed_attempts = 0,
         locked_until    = NULL
   WHERE id = p_staff_id;
  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

-- 7) สถิติภาพรวมสำหรับหน้าแดชบอร์ดแอดมิน
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
    'recent_activity', v_recent
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- 8) รายชื่อพนักงานทั้งหมดสำหรับหน้าแอดมิน
CREATE OR REPLACE FUNCTION api_admin_staff_list()
RETURNS jsonb AS $$
DECLARE
  v_staff jsonb;
  v_branches jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'role', s.role,
    'branch_id', s.branch_id,
    'branch_name', COALESCE(b.name, 'ทุกสาขา'),
    'failed_attempts', s.failed_attempts,
    'is_locked', (s.locked_until IS NOT NULL AND s.locked_until > now()),
    'locked_until', s.locked_until,
    'revoked_at', s.revoked_at,
    'created_at', s.created_at
  ) ORDER BY (s.revoked_at IS NOT NULL) ASC, s.role = 'owner' DESC, s.name ASC), '[]'::jsonb)
  INTO v_staff
  FROM staff_users s
  LEFT JOIN branches b ON b.id = s.branch_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'code', b.code,
    'name', b.name
  ) ORDER BY b.name ASC), '[]'::jsonb)
  INTO v_branches
  FROM branches b
  WHERE b.is_active;

  RETURN jsonb_build_object('ok', true, 'staff', v_staff, 'branches', v_branches);
END;
$$ LANGUAGE plpgsql STABLE;

-- 9) เพิ่มพนักงานใหม่จากหน้าแอดมิน
CREATE OR REPLACE FUNCTION api_admin_add_staff(
  p_name text,
  p_role staff_role,
  p_pin_hash text,
  p_branch_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_staff staff_users%ROWTYPE;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_required');
  END IF;
  IF p_role <> 'owner' AND p_branch_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'branch_required_for_staff');
  END IF;

  INSERT INTO staff_users (name, role, pin_hash, branch_id)
  VALUES (trim(p_name), p_role, p_pin_hash, CASE WHEN p_role = 'owner' THEN NULL ELSE p_branch_id END)
  RETURNING * INTO v_staff;

  RETURN jsonb_build_object('ok', true, 'id', v_staff.id, 'name', v_staff.name, 'role', v_staff.role);
END;
$$ LANGUAGE plpgsql;

-- 10) อัปเดตข้อมูลพนักงาน (รีเซ็ต PIN / ปลดล็อก / แก้ไขชื่อหรือสาขา)
CREATE OR REPLACE FUNCTION api_admin_update_staff(
  p_staff_id uuid,
  p_name text,
  p_role staff_role,
  p_branch_id uuid,
  p_pin_hash text DEFAULT NULL,
  p_unlock boolean DEFAULT false
) RETURNS jsonb AS $$
DECLARE
  v_staff staff_users%ROWTYPE;
BEGIN
  UPDATE staff_users
     SET name            = COALESCE(NULLIF(trim(p_name), ''), name),
         role            = COALESCE(p_role, role),
         branch_id       = CASE WHEN COALESCE(p_role, role) = 'owner' THEN NULL ELSE COALESCE(p_branch_id, branch_id) END,
         pin_hash        = COALESCE(p_pin_hash, pin_hash),
         failed_attempts = CASE WHEN p_unlock THEN 0 ELSE failed_attempts END,
         locked_until    = CASE WHEN p_unlock THEN NULL ELSE locked_until END
   WHERE id = p_staff_id
  RETURNING * INTO v_staff;

  IF v_staff.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staff_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_staff.id, 'name', v_staff.name);
END;
$$ LANGUAGE plpgsql;

-- 11) เพิกถอนพนักงาน (Revoke)
CREATE OR REPLACE FUNCTION api_admin_revoke_staff(p_staff_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_staff staff_users%ROWTYPE;
BEGIN
  UPDATE staff_users
     SET revoked_at = now()
   WHERE id = p_staff_id
  RETURNING * INTO v_staff;

  IF v_staff.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'staff_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_staff.id);
END;
$$ LANGUAGE plpgsql;

-- 12) ข้อมูล Checkpoints และตัวเลือกรางวัล
CREATE OR REPLACE FUNCTION api_admin_get_rewards()
RETURNS jsonb AS $$
DECLARE
  v_data jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'slot_no', c.slot_no,
    'label', c.label,
    'is_active', c.is_active,
    'options', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'sort', o.sort,
        'is_active', o.is_active,
        'used_count', (SELECT count(*)::int FROM entitlements e WHERE e.chosen_option_id = o.id)
      ) ORDER BY o.sort, o.name), '[]'::jsonb)
      FROM reward_options o
      WHERE o.checkpoint_id = c.id
    )
  ) ORDER BY c.slot_no), '[]'::jsonb)
  INTO v_data
  FROM reward_checkpoints c;

  RETURN jsonb_build_object('ok', true, 'checkpoints', v_data);
END;
$$ LANGUAGE plpgsql STABLE;

-- 13) เปิด/ปิดตัวเลือกรางวัล (เช่น วันไหนโค้กหมด ปิดตัวเลือกนี้ทันที)
CREATE OR REPLACE FUNCTION api_admin_toggle_reward_option(p_option_id uuid, p_is_active boolean)
RETURNS jsonb AS $$
DECLARE
  v_opt reward_options%ROWTYPE;
BEGIN
  UPDATE reward_options
     SET is_active = p_is_active
   WHERE id = p_option_id
  RETURNING * INTO v_opt;

  IF v_opt.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'option_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_opt.id, 'is_active', v_opt.is_active);
END;
$$ LANGUAGE plpgsql;

-- 14) เพิ่มตัวเลือกรางวัลใหม่ใน checkpoint
CREATE OR REPLACE FUNCTION api_admin_add_reward_option(p_checkpoint_id uuid, p_name text, p_sort int DEFAULT 1)
RETURNS jsonb AS $$
DECLARE
  v_opt reward_options%ROWTYPE;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_required');
  END IF;

  INSERT INTO reward_options (checkpoint_id, name, sort, is_active)
  VALUES (p_checkpoint_id, trim(p_name), COALESCE(p_sort, 1), true)
  RETURNING * INTO v_opt;

  RETURN jsonb_build_object('ok', true, 'id', v_opt.id, 'name', v_opt.name);
END;
$$ LANGUAGE plpgsql;

-- 15) ดึงและอัปเดตการตั้งค่าระบบ (app_settings)
CREATE OR REPLACE FUNCTION api_admin_get_settings()
RETURNS jsonb AS $$
  SELECT jsonb_build_object('ok', true, 'settings',
    COALESCE(jsonb_object_agg(key, jsonb_build_object('value', value, 'description', description, 'updated_at', updated_at)), '{}'::jsonb)
  )
  FROM app_settings;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION api_admin_update_setting(p_key text, p_value jsonb, p_updater uuid)
RETURNS jsonb AS $$
DECLARE
  v_row app_settings%ROWTYPE;
BEGIN
  UPDATE app_settings
     SET value      = p_value,
         updated_at = now(),
         updated_by = p_updater
   WHERE key = p_key
  RETURNING * INTO v_row;

  IF v_row.key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'key_not_found');
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('staff', p_updater, 'setting.update', p_key, jsonb_build_object('new_value', p_value));

  RETURN jsonb_build_object('ok', true, 'key', v_row.key, 'value', v_row.value);
END;
$$ LANGUAGE plpgsql;

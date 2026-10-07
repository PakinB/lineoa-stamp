-- ============================================================================
-- 0008: รายงานแยกสาขา · นับดวงจริงของ QR โปรโมชั่น · จำกัดช่วงข้อมูลที่หนัก
--
--  แก้สามเรื่องที่พบตอนทำรายงาน Excel ให้เจ้าของ
--
--  1) QR โปรโมชั่นถูกนับเป็น "1 ใบ" ทั้งที่ให้หลายดวง (earn_tokens.points
--     มีมาตั้งแต่ 0007 แต่ไม่เคยถูกใช้ในรายงาน) เจ้าของจึงมองไม่เห็นว่า
--     ดวงที่แจกไปจริงมีเท่าไหร่ และมาจากโปรโมชั่นกี่ใบ
--
--  2) ไม่เคยแยกตามสาขา — ตอนนี้มีสาขาเดียวจึงยังไม่เจ็บ แต่วันที่เปิดสาขาสอง
--     คำถามแรกของเจ้าของคือ "สาขาไหนพนักงานยื่น QR ขยันกว่ากัน"
--
--  3) daily_line_scans คืนหนึ่งแถวต่อ (วัน × ลูกค้า) ทุกวันตั้งแต่เปิดระบบ
--     แล้วฝังไปกับหน้า /admin ทุกครั้งที่เปิด ที่ 400 ลูกค้าหนึ่งปี
--     = หลักหมื่นแถวต่อการเปิดหนึ่งครั้ง
--
--  **การจำกัดช่วงไม่ได้ลบอะไร** ข้อมูลเก่ายังอยู่ครบในตาราง แค่ไม่ถูกดึงมา
--  ส่วนที่เบา (สรุปรายวัน สรุปรายสาขา) ยังคืนครบทุกวันตั้งแต่เปิดระบบเหมือนเดิม
-- ============================================================================

-- จำกัดเฉพาะข้อมูลที่โตตามจำนวนลูกค้า ไม่ใช่ทั้งรายงาน · ปรับได้จาก /admin/settings
INSERT INTO app_settings (key, value, description) VALUES
  ('report_window_days', '90',
   'ย้อนหลังกี่วันสำหรับรายงานที่แตกเป็นรายคน/รายสาขาต่อวัน — สรุปรายวันยังคืนครบทุกวัน')
ON CONFLICT (key) DO NOTHING;


CREATE OR REPLACE FUNCTION api_admin_stats()
RETURNS jsonb AS $$
DECLARE
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok';
  v_window      int;
  v_since       timestamptz;
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
  v_branches     jsonb;
  v_branch_daily jsonb;
  v_line_scans   jsonb;
BEGIN
  v_window := COALESCE((SELECT (value #>> '{}')::int FROM app_settings WHERE key = 'report_window_days'), 90);
  v_since  := now() - make_interval(days => v_window);

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
    'id', l.id, 'slot_no', l.slot_no, 'source', l.source,
    'customer_name', COALESCE(c.display_name, 'ลูกค้า'),
    'branch_name', COALESCE(b.name, 'ไม่ระบุสาขา'), 'created_at', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (SELECT * FROM stamp_ledger ORDER BY created_at DESC LIMIT 15) l
  JOIN customers c ON c.id = l.customer_id
  LEFT JOIN branches b ON b.id = l.branch_id;

  -- สรุปรายวันรวมทุกสาขา — คืนครบทุกวันตั้งแต่เปิดระบบ (หนึ่งแถวต่อวัน จึงเบา)
  -- issued/claimed นับเป็น "ใบ" · stamps นับเป็น "ดวง" (รวม points ของ QR โปรโมชั่น)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(d.day, 'YYYY-MM-DD'), 'date_th', to_char(d.day, 'DD/MM/YYYY'),
    'issued', d.issued, 'claimed', d.claimed, 'unclaimed', d.unclaimed, 'rate', d.rate,
    'stamps', d.stamps, 'promo_issued', d.promo_issued, 'promo_claimed', d.promo_claimed
  ) ORDER BY d.day DESC), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT date_trunc('day', issued_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
      count(*)::int AS issued,
      count(*) FILTER (WHERE status = 'consumed')::int AS claimed,
      (count(*) - count(*) FILTER (WHERE status = 'consumed'))::int AS unclaimed,
      COALESCE(sum(points) FILTER (WHERE status = 'consumed'), 0)::int AS stamps,
      count(*) FILTER (WHERE points > 1)::int AS promo_issued,
      count(*) FILTER (WHERE points > 1 AND status = 'consumed')::int AS promo_claimed,
      CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE status = 'consumed')::numeric / count(*)::numeric) * 100, 1) ELSE 0 END AS rate
    FROM earn_tokens GROUP BY date_trunc('day', issued_at AT TIME ZONE 'Asia/Bangkok')::date
  ) d;

  -- สรุปต่อสาขาทั้งช่วงที่มีข้อมูล — มากสุด 5 แถว จึงไม่ต้องจำกัดช่วง
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'branch_name', s.branch_name, 'issued', s.issued, 'claimed', s.claimed,
    'unclaimed', s.unclaimed, 'stamps', s.stamps, 'rate', s.rate
  ) ORDER BY s.issued DESC, s.branch_name), '[]'::jsonb)
  INTO v_branches
  FROM (
    SELECT b.name AS branch_name,
      count(*)::int AS issued,
      count(*) FILTER (WHERE t.status = 'consumed')::int AS claimed,
      (count(*) - count(*) FILTER (WHERE t.status = 'consumed'))::int AS unclaimed,
      COALESCE(sum(t.points) FILTER (WHERE t.status = 'consumed'), 0)::int AS stamps,
      CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE t.status = 'consumed')::numeric / count(*)::numeric) * 100, 1) ELSE 0 END AS rate
    FROM earn_tokens t JOIN branches b ON b.id = t.branch_id
    GROUP BY b.id, b.name
  ) s;

  -- รายสาขาต่อวัน — โตตามจำนวนสาขา × วัน จึงจำกัดช่วง
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(s.day, 'YYYY-MM-DD'), 'branch_name', s.branch_name,
    'issued', s.issued, 'claimed', s.claimed, 'stamps', s.stamps, 'rate', s.rate
  ) ORDER BY s.day DESC, s.issued DESC, s.branch_name), '[]'::jsonb)
  INTO v_branch_daily
  FROM (
    SELECT date_trunc('day', t.issued_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
      b.name AS branch_name,
      count(*)::int AS issued,
      count(*) FILTER (WHERE t.status = 'consumed')::int AS claimed,
      COALESCE(sum(t.points) FILTER (WHERE t.status = 'consumed'), 0)::int AS stamps,
      CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE t.status = 'consumed')::numeric / count(*)::numeric) * 100, 1) ELSE 0 END AS rate
    FROM earn_tokens t JOIN branches b ON b.id = t.branch_id
    WHERE t.issued_at >= v_since
    GROUP BY date_trunc('day', t.issued_at AT TIME ZONE 'Asia/Bangkok')::date, b.name
  ) s;

  -- รายบัญชี LINE ต่อวัน — ก้อนที่หนักที่สุด (วัน × ลูกค้า) จึงจำกัดช่วงแน่นอน
  -- qr_scans นับเป็นใบ · stamps คือดวงที่ลูกค้าได้จริง (QR โปรโมชั่นใบเดียวได้หลายดวง)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(s.day, 'YYYY-MM-DD'), 'date_th', to_char(s.day, 'DD/MM/YYYY'),
    'line_name', s.line_name, 'qr_scans', s.qr_scans, 'stamps', s.stamps
  ) ORDER BY s.day DESC, s.qr_scans DESC, s.line_name), '[]'::jsonb)
  INTO v_line_scans
  FROM (
    SELECT date_trunc('day', t.issued_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
      COALESCE(c.display_name, 'ลูกค้า') AS line_name,
      count(*)::int AS qr_scans,
      COALESCE(sum(t.points), 0)::int AS stamps
    FROM earn_tokens t
    JOIN customers c ON c.id = t.consumed_by
    WHERE t.status = 'consumed' AND t.issued_at >= v_since
    GROUP BY date_trunc('day', t.issued_at AT TIME ZONE 'Asia/Bangkok')::date, COALESCE(c.display_name, 'ลูกค้า')
  ) s;

  RETURN jsonb_build_object(
    'ok', true, 'stamps_today', v_stamps_today, 'stamps_all', v_stamps_all,
    'customers_all', v_cust_all, 'rewards_today', v_rew_today, 'rewards_all', v_rew_all,
    'rewards_pending', v_rew_pending, 'tokens_today', v_tokens_today, 'tokens_used', v_tokens_used,
    'recent_activity', v_recent, 'daily_stats', v_daily, 'daily_line_scans', v_line_scans,
    'branch_stats', v_branches, 'branch_daily', v_branch_daily,
    'report_window_days', v_window
  );
END;
$$ LANGUAGE plpgsql STABLE;

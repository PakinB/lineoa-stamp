-- ============================================================================
-- 0006: รายงาน QR รายวันแยกตามบัญชี LINE
-- ============================================================================

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
  v_line_scans   jsonb;
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
    'id', l.id, 'slot_no', l.slot_no, 'source', l.source,
    'customer_name', COALESCE(c.display_name, 'ลูกค้า'),
    'branch_name', COALESCE(b.name, 'ไม่ระบุสาขา'), 'created_at', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_recent
  FROM (SELECT * FROM stamp_ledger ORDER BY created_at DESC LIMIT 15) l
  JOIN customers c ON c.id = l.customer_id
  LEFT JOIN branches b ON b.id = l.branch_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(d.day, 'YYYY-MM-DD'), 'date_th', to_char(d.day, 'DD/MM/YYYY'),
    'issued', d.issued, 'claimed', d.claimed, 'unclaimed', d.unclaimed, 'rate', d.rate
  ) ORDER BY d.day DESC), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT date_trunc('day', issued_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
      count(*)::int AS issued, count(*) FILTER (WHERE status = 'consumed')::int AS claimed,
      (count(*) - count(*) FILTER (WHERE status = 'consumed'))::int AS unclaimed,
      CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE status = 'consumed')::numeric / count(*)::numeric) * 100, 1) ELSE 0 END AS rate
    FROM earn_tokens GROUP BY date_trunc('day', issued_at AT TIME ZONE 'Asia/Bangkok')::date
  ) d;

  -- QR ที่สแกนสำเร็จเท่านั้น และนับรายวันต่อชื่อ LINE เพื่อใช้ใน Excel
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(s.day, 'YYYY-MM-DD'), 'date_th', to_char(s.day, 'DD/MM/YYYY'),
    'line_name', s.line_name, 'qr_scans', s.qr_scans
  ) ORDER BY s.day DESC, s.qr_scans DESC, s.line_name), '[]'::jsonb)
  INTO v_line_scans
  FROM (
    SELECT date_trunc('day', t.issued_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
      COALESCE(c.display_name, 'ลูกค้า') AS line_name,
      count(*)::int AS qr_scans
    FROM earn_tokens t
    JOIN customers c ON c.id = t.consumed_by
    WHERE t.status = 'consumed'
    GROUP BY date_trunc('day', t.issued_at AT TIME ZONE 'Asia/Bangkok')::date, COALESCE(c.display_name, 'ลูกค้า')
  ) s;

  RETURN jsonb_build_object(
    'ok', true, 'stamps_today', v_stamps_today, 'stamps_all', v_stamps_all,
    'customers_all', v_cust_all, 'rewards_today', v_rew_today, 'rewards_all', v_rew_all,
    'rewards_pending', v_rew_pending, 'tokens_today', v_tokens_today, 'tokens_used', v_tokens_used,
    'recent_activity', v_recent, 'daily_stats', v_daily, 'daily_line_scans', v_line_scans
  );
END;
$$ LANGUAGE plpgsql STABLE;

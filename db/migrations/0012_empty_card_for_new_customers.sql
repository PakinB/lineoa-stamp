-- ============================================================================
-- 0012: ลูกค้าใหม่ที่ยังไม่เคยสแกน ต้องเห็นบัตรใบเปล่า ไม่ใช่ข้อความเปล่า
--
--  เดิม get_card_state คืน card: null ถ้ายังไม่มีบัตรในฐานข้อมูล เพราะบัตร
--  ถูกสร้างตอนปั๊มดวงแรกเท่านั้น คนที่กด "แต้มของฉัน" จากริชเมนูก่อนเคยสแกน
--  จึงเห็นแค่ข้อความบรรทัดเดียว ไม่เห็นหน้าตาบัตรและไม่รู้ว่าสะสมแล้วได้อะไร
--  — เจอจริงในข้อมูล production มีลูกค้าที่ยินยอม PDPA แล้วแต่ 0 ดวง 0 บัตร
--
--  แก้โดย "วาดใบเปล่าให้ดู" ไม่ใช่ "สร้างบัตรจริง" เพราะ
--   · การสร้างแถวตอนเปิดหน้า = เขียนฐานข้อมูลบนเส้นทางอ่าน ซึ่งไม่ควร
--   · จะได้บัตรเปล่าค้างของคนที่แค่เปิดดูแล้วไม่เคยซื้อ ทำให้รายงานเพี้ยน
--   · ตอนปั๊มดวงแรก award_stamp สร้างบัตรจริงให้อยู่แล้ว ไม่ต้องแตะ
--
--  ผลข้างเคียงที่ตั้งใจ: card.id เป็น null ได้แล้ว (ตรวจแล้วไม่มีใครใช้ค่านี้)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_card_state(p_customer_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_card   stamp_cards%ROWTYPE;
  v_size   int;
  v_filled int;
  v_slots  jsonb;
  v_ents   jsonb;
  v_next   jsonb;
BEGIN
  SELECT * INTO v_card FROM stamp_cards
   WHERE customer_id = p_customer_id AND status = 'active';

  -- ยังไม่มีบัตร → ใช้ขนาดมาตรฐานจากค่าตั้งค่า แล้วปล่อยให้ทุกช่องว่าง
  -- v_card.id เป็น null ทำให้ LEFT JOIN ข้างล่างไม่เจอแถวไหนเลยโดยอัตโนมัติ
  -- จึงใช้โค้ดวาดช่องชุดเดียวกันได้ทั้งสองกรณี ไม่ต้องเขียนแยก
  v_size   := COALESCE(v_card.size,
                       (SELECT NULLIF(value, 'null'::jsonb)::int
                          FROM app_settings WHERE key = 'card_size'),
                       10);
  v_filled := COALESCE(v_card.filled, 0);

  -- สิทธิ์ที่ยังใช้ได้ นับรวมของบัตรใบเก่าที่ยังไม่ได้ใช้ (สแตมป์ไม่มีวันหมดอายุ)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'label', c.label, 'status', e.status
         ) ORDER BY e.created_at), '[]'::jsonb)
    INTO v_ents
    FROM entitlements e
    JOIN reward_checkpoints c ON c.id = e.checkpoint_id
   WHERE e.customer_id = p_customer_id
     AND e.status = 'available';

  -- ทุกช่องของบัตร พร้อมสถานะและ checkpoint ที่แปะอยู่
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.no) INTO v_slots FROM (
    SELECT
      g.n AS no,
      CASE WHEN l.id IS NOT NULL THEN 'filled' ELSE 'empty' END AS state,
      b.name       AS branch,
      l.created_at AS at,
      CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
        'label',  c.label,
        'status', CASE
                    WHEN e.status = 'used' THEN 'used'
                    WHEN e.id IS NOT NULL  THEN 'available'
                    ELSE 'locked'
                  END
      ) END AS checkpoint
    FROM generate_series(1, v_size) AS g(n)
    LEFT JOIN stamp_ledger l ON l.card_id = v_card.id AND l.slot_no = g.n
    LEFT JOIN branches b     ON b.id = l.branch_id
    LEFT JOIN reward_checkpoints c ON c.slot_no = g.n AND c.is_active
    LEFT JOIN entitlements e ON e.card_id = v_card.id AND e.checkpoint_id = c.id
  ) s;

  -- checkpoint ถัดไปที่ยังไปไม่ถึง — ลูกค้าใหม่จะได้เห็นว่าอีกกี่ดวงได้อะไร
  SELECT jsonb_build_object('slot_no', slot_no, 'remaining', slot_no - v_filled)
    INTO v_next
    FROM reward_checkpoints
   WHERE is_active AND slot_no > v_filled
   ORDER BY slot_no LIMIT 1;

  RETURN jsonb_build_object(
    'card', jsonb_build_object(
      'id',      v_card.id,                      -- null = ใบเปล่าที่ยังไม่ได้สร้างจริง
      'card_no', COALESCE(v_card.card_no, 1),
      'size',    v_size,
      'filled',  v_filled,
      'slots',   COALESCE(v_slots, '[]'::jsonb)
    ),
    'entitlements',    v_ents,
    'next_checkpoint', v_next
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
--  ตรรกะแกนกลาง — เก็บไว้ในฐานข้อมูล ไม่ใช่ในโค้ดแอป
--
--  เหตุผล (เอกสารออกแบบ §5): ให้ฐานข้อมูลเป็นคนตัดสินว่าใครมาถึงก่อน
--  ไม่ต้องพึ่ง Redis หรือ distributed lock และไม่ว่าใครเรียก (เว็บพนักงาน
--  หรือ POS ในอนาคต) ก็ได้ตรรกะเดียวกันเป๊ะ ๆ
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) บังคับให้ stamp_ledger เป็น append-only จริง ๆ
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stamp_ledger เป็น append-only: ห้าม % แถวที่บันทึกแล้ว', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stamp_ledger_no_update
  BEFORE UPDATE OR DELETE ON stamp_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();


-- ---------------------------------------------------------------------------
--  2) get_card_state — สถานะบัตร "พร้อมวาด" สำหรับหน้าเว็บ
--
--  §14: คำนวณทุกอย่างฝั่งเซิร์ฟเวอร์ ฝั่งหน้าเว็บแค่ map ไม่ต้องรู้กติกาธุรกิจ
--  ถ้าหน้าเว็บต้องเขียนเงื่อนไขคำนวณเองว่าช่องไหนเป็น checkpoint
--  แปลว่าฟังก์ชันนี้คืนข้อมูลไม่ครบ
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_card_state(p_customer_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_card  stamp_cards%ROWTYPE;
  v_slots jsonb;
  v_ents  jsonb;
  v_next  jsonb;
BEGIN
  SELECT * INTO v_card FROM stamp_cards
   WHERE customer_id = p_customer_id AND status = 'active';

  -- สิทธิ์ที่ยังใช้ได้ นับรวมของบัตรใบเก่าที่ยังไม่ได้ใช้ (สแตมป์ไม่มีวันหมดอายุ)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'label', c.label, 'status', e.status
         ) ORDER BY e.created_at), '[]'::jsonb)
    INTO v_ents
    FROM entitlements e
    JOIN reward_checkpoints c ON c.id = e.checkpoint_id
   WHERE e.customer_id = p_customer_id
     AND e.status = 'available';

  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('card', NULL, 'entitlements', v_ents,
                              'next_checkpoint', NULL);
  END IF;

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
    FROM generate_series(1, v_card.size) AS g(n)
    LEFT JOIN stamp_ledger l ON l.card_id = v_card.id AND l.slot_no = g.n
    LEFT JOIN branches b     ON b.id = l.branch_id
    LEFT JOIN reward_checkpoints c ON c.slot_no = g.n AND c.is_active
    LEFT JOIN entitlements e ON e.card_id = v_card.id AND e.checkpoint_id = c.id
  ) s;

  -- checkpoint ถัดไปที่ยังไปไม่ถึง
  SELECT jsonb_build_object('slot_no', slot_no, 'remaining', slot_no - v_card.filled)
    INTO v_next
    FROM reward_checkpoints
   WHERE is_active AND slot_no > v_card.filled
   ORDER BY slot_no LIMIT 1;

  RETURN jsonb_build_object(
    'card', jsonb_build_object(
      'id',      v_card.id,
      'card_no', v_card.card_no,
      'size',    v_card.size,
      'filled',  v_card.filled,
      'slots',   COALESCE(v_slots, '[]'::jsonb)
    ),
    'entitlements',    v_ents,
    'next_checkpoint', v_next
  );
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  3) award_stamp — ปั๊มสแตมป์หนึ่งดวง (ทางเข้าเดียวของทุกช่องทาง)
--
--  หาบัตรที่เปิดอยู่ (ไม่มีก็เปิดใหม่) -> ปั๊มลงช่องถัดไป -> อัปเดตตัวนับ
--  -> สร้างสิทธิ์ถ้าถึง checkpoint -> ปิดบัตรและเปิดใบใหม่ถ้าเต็ม
--
--  เรียกซ้ำด้วย p_idempotency_key เดิมจะได้ผลลัพธ์เดิม ไม่ปั๊มเพิ่ม
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION award_stamp(
  p_customer_id     uuid,
  p_source          stamp_source,
  p_idempotency_key text,
  p_branch_id       uuid DEFAULT NULL,
  p_note            text DEFAULT NULL,
  p_created_by      uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_card      stamp_cards%ROWTYPE;
  v_slot      int;
  v_stamp_id  bigint;
  v_card_size int;
  v_new_ents  jsonb;
  v_existing  bigint;
  v_exist_slot int;
BEGIN
  -- กันเรียกซ้ำ: กุญแจนี้เคยใช้แล้ว คืนสถานะปัจจุบันโดยไม่ปั๊มเพิ่ม
  SELECT id, slot_no INTO v_existing, v_exist_slot
    FROM stamp_ledger WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true, 'stamp_id', v_existing,
      'stamped_slot', v_exist_slot,
      'new_entitlements', '[]'::jsonb,
      'card', get_card_state(p_customer_id)
    );
  END IF;

  -- ล็อกต่อลูกค้าหนึ่งคน กันสองรีเควสต์ปั๊มพร้อมกัน
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));

  SELECT * INTO v_card FROM stamp_cards
   WHERE customer_id = p_customer_id AND status = 'active'
   FOR UPDATE;

  IF v_card.id IS NULL THEN
    SELECT COALESCE((value->>'card_size')::int, 10) INTO v_card_size
      FROM app_settings WHERE key = 'card_size';

    INSERT INTO stamp_cards (customer_id, card_no, size)
    VALUES (
      p_customer_id,
      COALESCE((SELECT MAX(card_no) FROM stamp_cards
                 WHERE customer_id = p_customer_id), 0) + 1,
      COALESCE(v_card_size, 10)
    )
    RETURNING * INTO v_card;
  END IF;

  v_slot := v_card.filled + 1;

  INSERT INTO stamp_ledger
    (customer_id, card_id, slot_no, branch_id, source, note,
     idempotency_key, created_by)
  VALUES
    (p_customer_id, v_card.id, v_slot, p_branch_id, p_source, p_note,
     p_idempotency_key, p_created_by)
  RETURNING id INTO v_stamp_id;

  UPDATE stamp_cards SET filled = v_slot WHERE id = v_card.id;

  -- ถึง checkpoint ไหม? ถ้าถึง สร้างสิทธิ์ให้เลย ลูกค้าไม่ต้องกดแลก
  WITH created AS (
    INSERT INTO entitlements (customer_id, card_id, checkpoint_id, slot_no)
    SELECT p_customer_id, v_card.id, c.id, c.slot_no
      FROM reward_checkpoints c
     WHERE c.slot_no = v_slot AND c.is_active
    ON CONFLICT (card_id, checkpoint_id) DO NOTHING
    RETURNING id, checkpoint_id, slot_no
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', cr.id, 'slot_no', cr.slot_no, 'label', rc.label
         )), '[]'::jsonb)
    INTO v_new_ents
    FROM created cr
    JOIN reward_checkpoints rc ON rc.id = cr.checkpoint_id;

  -- บัตรเต็ม -> ปิดใบนี้แล้วเปิดใบใหม่ทันที ลูกค้าไม่มีจังหวะที่ไม่มีบัตร
  IF v_slot >= v_card.size THEN
    UPDATE stamp_cards
       SET status = 'completed', completed_at = now()
     WHERE id = v_card.id;

    INSERT INTO stamp_cards (customer_id, card_no, size)
    VALUES (p_customer_id, v_card.card_no + 1, v_card.size);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'stamp_id', v_stamp_id,
    -- ช่องที่เพิ่งถูกปั๊ม — หน้าเว็บใช้เล่นอนิเมชั่นตรงดวงนี้
    -- ห้ามให้หน้าเว็บ diff เอาเอง เพราะถ้าเปิดหน้าใหม่จะไม่มีสถานะก่อนหน้าให้เทียบ
    'stamped_slot', v_slot,
    'card_completed', (v_slot >= v_card.size),
    'new_entitlements', v_new_ents,
    'card', get_card_state(p_customer_id)
  );
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  4) claim_earn_token — ลูกค้าสแกน QR (โหมด A)
--
--  UPDATE ... WHERE status='active' ล็อกแถวให้เอง: สองรีเควสต์พร้อมกัน
--  จะมีตัวเดียวได้ 1 แถว อีกตัวได้ 0 แถว — นี่คือหัวใจของ "สแกนซ้ำไม่ได้"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_earn_token(
  p_customer_id uuid,
  p_code        text
) RETURNS jsonb AS $$
DECLARE
  v_token earn_tokens%ROWTYPE;
BEGIN
  UPDATE earn_tokens
     SET status = 'consumed', consumed_at = now(), consumed_by = p_customer_id
   WHERE code = p_code
     AND status = 'active'
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING * INTO v_token;

  IF v_token.id IS NULL THEN
    -- แยกเคส "คุณเองสแกนไปแล้ว" เพื่อไม่ให้ลูกค้าตกใจว่าแต้มหาย
    IF EXISTS (SELECT 1 FROM earn_tokens
                WHERE code = p_code AND consumed_by = p_customer_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed_by_you',
                                'card', get_card_state(p_customer_id));
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  END IF;

  RETURN award_stamp(
    p_customer_id     => p_customer_id,
    p_source          => 'qr',
    p_idempotency_key => 'token:' || p_code,
    p_branch_id       => v_token.branch_id
  );
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  5) approve_delivery_claim — เจ้าของกดอนุมัติรูปใบเสร็จเดลิเวอรี่
--
--  ปั๊มสแตมป์ก่อน แล้วค่อยอัปเดตคำขอครั้งเดียวพร้อม stamp_id
--  (constraint approved_has_stamp บังคับว่า approved ต้องมี stamp_id เสมอ)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_delivery_claim(
  p_claim_id uuid,
  p_reviewer uuid
) RETURNS jsonb AS $$
DECLARE
  v_claim  delivery_claims%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_claim FROM delivery_claims
   WHERE id = p_claim_id AND status = 'pending'
   FOR UPDATE;

  IF v_claim.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  v_result := award_stamp(
    p_customer_id     => v_claim.customer_id,
    p_source          => 'delivery',
    p_idempotency_key => 'claim:' || p_claim_id::text
  );

  UPDATE delivery_claims
     SET status      = 'approved',
         reviewed_by = p_reviewer,
         reviewed_at = now(),
         stamp_id    = (v_result->>'stamp_id')::bigint
   WHERE id = p_claim_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  6) reject_delivery_claim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_delivery_claim(
  p_claim_id uuid,
  p_reviewer uuid,
  p_reason   text
) RETURNS jsonb AS $$
DECLARE
  v_claim delivery_claims%ROWTYPE;
BEGIN
  UPDATE delivery_claims
     SET status = 'rejected', reviewed_by = p_reviewer,
         reviewed_at = now(), reject_reason = p_reason
   WHERE id = p_claim_id AND status = 'pending'
  RETURNING * INTO v_claim;

  IF v_claim.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;
  RETURN jsonb_build_object('ok', true, 'claim_id', p_claim_id);
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  7) issue_redeem_token — พนักงานกด "รับรางวัล" แล้วโชว์ QR ให้ลูกค้าสแกน
--
--  ทิศทางเดียวกับตอนสะสมแต้ม: พนักงานโชว์ ลูกค้าสแกน
--  ลูกค้าจึงไม่ต้องเรียนรู้ท่าใหม่ และเครื่องพนักงานไม่ต้องมีกล้อง
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION issue_redeem_token(
  p_branch_id uuid,
  p_staff_id  uuid,
  p_code      text
) RETURNS jsonb AS $$
DECLARE v_ttl int;
BEGIN
  SELECT COALESCE((value->>'redeem_token_ttl_minutes')::int, 5) INTO v_ttl
    FROM app_settings WHERE key = 'redeem_token_ttl_minutes';

  INSERT INTO redeem_tokens (code, branch_id, issued_by, expires_at)
  VALUES (p_code, p_branch_id, p_staff_id,
          now() + make_interval(mins => COALESCE(v_ttl, 5)));

  RETURN jsonb_build_object('ok', true, 'code', p_code,
    'expires_at', now() + make_interval(mins => COALESCE(v_ttl, 5)));
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  8) list_redeemable — ลูกค้าสแกน QR แล้วเห็นสิทธิ์ที่ตัวเองใช้ได้
--
--  ยังไม่ตัดอะไร แค่แสดงรายการให้เลือก
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_redeemable(
  p_customer_id uuid,
  p_code        text
) RETURNS jsonb AS $$
DECLARE
  v_tok  redeem_tokens%ROWTYPE;
  v_list jsonb;
BEGIN
  SELECT * INTO v_tok FROM redeem_tokens
   WHERE code = p_code AND status = 'active' AND expires_at > now();

  IF v_tok.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  END IF;

  -- สิทธิ์ที่ใช้ได้ พร้อมตัวเลือกของแต่ละอัน
  -- ของที่เจ้าของปิดไว้ในหน้าแอดมิน (เช่น โค้กหมด) จะไม่โผล่มาให้เลือกเลย
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'entitlement_id', e.id,
           'label', c.label,
           'options', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)
                                                 ORDER BY o.sort), '[]'::jsonb)
                         FROM reward_options o
                        WHERE o.checkpoint_id = c.id AND o.is_active)
         ) ORDER BY e.created_at), '[]'::jsonb)
    INTO v_list
    FROM entitlements e
    JOIN reward_checkpoints c ON c.id = e.checkpoint_id
   WHERE e.customer_id = p_customer_id AND e.status = 'available';

  RETURN jsonb_build_object('ok', true, 'branch_id', v_tok.branch_id,
                            'entitlements', v_list);
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  9) redeem_with_token — ลูกค้าเลือกสิทธิ์แล้วใช้เลย ไม่มี dialog ยืนยัน
--
--  §4: การยืนยันคือการที่พนักงานส่งของให้ ไม่ใช่ปุ่มบนหน้าจอ
--  ปลอดภัยเพราะลูกค้าจะมาถึงขั้นนี้ได้ต้องสแกน QR ที่พนักงานเพิ่งกดออก
--  แปลว่ายืนอยู่หน้าเคาน์เตอร์จริง กดพลาดแก้ได้ด้วย void_redemption()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION redeem_with_token(
  p_customer_id    uuid,
  p_code           text,
  p_entitlement_id uuid,
  p_option_id      uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_tok    redeem_tokens%ROWTYPE;
  v_ent    entitlements%ROWTYPE;
  v_opt    uuid;
  v_given  text;
  v_n      int;
BEGIN
  -- แย่งสิทธิ์ใช้ QR: ล็อกแถวแบบเดียวกับตอนสะสม
  UPDATE redeem_tokens
     SET status = 'consumed', consumed_by = p_customer_id, consumed_at = now(),
         entitlement_id = p_entitlement_id
   WHERE code = p_code AND status = 'active' AND expires_at > now()
  RETURNING * INTO v_tok;

  IF v_tok.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  END IF;

  SELECT * INTO v_ent FROM entitlements
   WHERE id = p_entitlement_id AND customer_id = p_customer_id
     AND status = 'available'
   FOR UPDATE;

  IF v_ent.id IS NULL THEN
    RAISE EXCEPTION 'entitlement_not_available'
      USING ERRCODE = 'check_violation';   -- ม้วนกลับทั้งทรานแซกชัน QR ไม่ถูกใช้
  END IF;

  -- ปกติ checkpoint ละ 1 ตัวเลือก เลือกให้อัตโนมัติ
  IF p_option_id IS NULL THEN
    SELECT count(*) INTO v_n FROM reward_options
     WHERE checkpoint_id = v_ent.checkpoint_id AND is_active;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'option_required' USING ERRCODE = 'check_violation';
    END IF;
    SELECT id INTO v_opt FROM reward_options
     WHERE checkpoint_id = v_ent.checkpoint_id AND is_active;
  ELSE
    SELECT id INTO v_opt FROM reward_options
     WHERE id = p_option_id AND checkpoint_id = v_ent.checkpoint_id AND is_active;
    IF v_opt IS NULL THEN
      RAISE EXCEPTION 'invalid_option' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT name INTO v_given FROM reward_options WHERE id = v_opt;

  UPDATE entitlements
     SET status = 'used', used_at = now(), used_branch_id = v_tok.branch_id,
         chosen_option_id = v_opt, confirmed_by = v_tok.issued_by
   WHERE id = p_entitlement_id;

  RETURN jsonb_build_object('ok', true, 'entitlement_id', p_entitlement_id,
    'given', v_given, 'card', get_card_state(p_customer_id));
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 10) void_redemption — พนักงานกดคืนสิทธิ์เมื่อลูกค้ากดพลาด
--
--  แทนที่จะเอา dialog "แน่ใจไหม?" ไปขวางทุกคนเพื่อกันคนส่วนน้อยที่กดพลาด
--  ให้แก้ทีหลังได้แทน ทางเดินปกติจึงไม่มีอะไรมาขวางเลย
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_redemption(
  p_entitlement_id uuid,
  p_staff_id       uuid
) RETURNS jsonb AS $$
DECLARE
  v_ent entitlements%ROWTYPE;
  v_win int;
BEGIN
  SELECT COALESCE((value->>'redemption_undo_minutes')::int, 10) INTO v_win
    FROM app_settings WHERE key = 'redemption_undo_minutes';

  UPDATE entitlements
     SET status = 'available', used_at = NULL, used_branch_id = NULL,
         chosen_option_id = NULL, confirmed_by = NULL
   WHERE id = p_entitlement_id AND status = 'used'
     AND used_at > now() - make_interval(mins => COALESCE(v_win, 10))
  RETURNING * INTO v_ent;

  IF v_ent.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_undoable');
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, target)
  VALUES ('staff', p_staff_id, 'redemption.void', p_entitlement_id::text);

  RETURN jsonb_build_object('ok', true, 'entitlement_id', p_entitlement_id);
END;
$$ LANGUAGE plpgsql;

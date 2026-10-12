-- ============================================================================
-- 0020: แก้บั๊ก — กดบันทึกที่หน้า /admin/settings แล้วค่าจะเสียชนิด
--
--  อาการ: บันทึก token_ttl_minutes = 10 แล้วค่าที่เก็บกลายเป็น "10" (ข้อความ)
--  แทนที่จะเป็น 10 (ตัวเลข) จากนั้นทุกที่ที่อ่านค่าไปใช้ด้วย value::int จะพัง
--  ด้วย "cannot cast jsonb string to type integer" — ซึ่งแปลว่าออก QR ไม่ได้
--
--  ต้นเหตุ: postgres.js เห็นว่าพารามิเตอร์ปลายทางเป็น jsonb จึงแปลงค่าเป็น JSON
--  ให้เองอีกชั้น พอฝั่งแอปทำ JSON.stringify มาก่อนแล้วจึงกลายเป็นสตริงซ้อนสตริง
--
--  วิธีแก้ใช้แบบเดียวกับ api_admin_save_all_rewards ที่ทำงานถูกมาตลอด คือ
--  **รับเป็น text แล้ว cast เป็น jsonb เองข้างใน** postgres.js จะไม่ยุ่งกับค่า
--
--  ตรวจแล้วว่ายังไม่มีค่าไหนในระบบเสียหาย เพราะยังไม่เคยมีใครกดบันทึกสำเร็จ
-- ============================================================================

DROP FUNCTION IF EXISTS api_admin_update_setting(text, jsonb, uuid);

CREATE OR REPLACE FUNCTION api_admin_update_setting(p_key text, p_value text, p_updater uuid)
RETURNS jsonb AS $$
DECLARE v_row app_settings%ROWTYPE; v_json jsonb;
BEGIN
  BEGIN
    v_json := p_value::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_value');
  END;

  UPDATE app_settings
     SET value = v_json, updated_at = now(), updated_by = p_updater
   WHERE key = p_key
  RETURNING * INTO v_row;

  IF v_row.key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'key_not_found');
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, target, detail)
  VALUES ('staff', p_updater, 'setting.update', p_key, jsonb_build_object('new_value', v_json));

  RETURN jsonb_build_object('ok', true, 'key', v_row.key, 'value', v_row.value);
END;
$$ LANGUAGE plpgsql;


-- ฟังก์ชันของเดลิเวอรี่ก็รับ jsonb เหมือนกัน แต่ route ส่ง object ตรง ๆ
-- พร้อม ::jsonb จึงไม่โดนบั๊กนี้ · เขียนไว้กันลืมว่าสองแบบนี้ต่างกัน
COMMENT ON FUNCTION api_admin_update_setting(text, text, uuid) IS
  'รับค่าเป็นข้อความ JSON แล้ว cast เอง — ห้ามเปลี่ยนเป็น jsonb เพราะ postgres.js จะ encode ซ้ำ';

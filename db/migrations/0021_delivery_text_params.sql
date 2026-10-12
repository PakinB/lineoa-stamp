-- ============================================================================
-- 0021: ให้ฟังก์ชันของเดลิเวอรี่รับ JSON เป็น text แล้ว cast เอง
--
--  เหตุผลเดียวกับ 0020 — postgres.js แปลงค่าเป็น JSON ให้เองเมื่อปลายทางเป็น
--  jsonb ทำให้ค่าที่ stringify มาแล้วกลายเป็นสตริงซ้อนสตริง
--
--  แพตเทิร์นนี้คือที่ api_admin_save_all_rewards ใช้มาตั้งแต่ 0005 และทำงานถูก
--  มาตลอด · ตัวคิดเงิน delivery_calc ยังรับ jsonb เหมือนเดิมเพราะถูกเรียกจาก
--  ฝั่ง SQL ด้วยกัน ไม่ได้ผ่าน postgres.js
-- ============================================================================

DROP FUNCTION IF EXISTS api_delivery_quote(uuid, jsonb);
CREATE OR REPLACE FUNCTION api_delivery_quote(p_zone_id uuid, p_items text)
RETURNS jsonb AS $$
  SELECT delivery_calc(p_zone_id, p_items::jsonb);
$$ LANGUAGE sql STABLE;


-- เปลี่ยนชื่อตัวที่รับ jsonb เป็น _json แล้วให้ตัวใหม่ที่รับ text ห่อไว้
ALTER FUNCTION api_delivery_create(text, text, text, jsonb) RENAME TO api_delivery_create_json;
CREATE OR REPLACE FUNCTION api_delivery_create(
  p_line_user_id text, p_name text, p_pic text, p_payload text
) RETURNS jsonb AS $$
  SELECT api_delivery_create_json(p_line_user_id, p_name, p_pic, p_payload::jsonb);
$$ LANGUAGE sql;


ALTER FUNCTION api_admin_delivery_save(text, jsonb, uuid) RENAME TO api_admin_delivery_save_json;
CREATE OR REPLACE FUNCTION api_admin_delivery_save(p_kind text, p_data text, p_staff uuid)
RETURNS jsonb AS $$
  SELECT api_admin_delivery_save_json(p_kind, p_data::jsonb, p_staff);
$$ LANGUAGE sql;

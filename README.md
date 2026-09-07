# ระบบบัตรสแตมป์ร้านหมาล่า

บัตรสะสม 10 ดวงบน LINE · 1 บิล = 1 ดวง · รางวัลเป็น checkpoint บนบัตร ·
สะสมและรับรางวัลข้ามสาขาได้ · ไม่มีวันหมดอายุ

[เอกสารออกแบบฉบับเต็ม](docs/design.md) — แหล่งความจริง อยู่ในรีโปนี้

## เริ่มต้น

```bash
npm install
cp .env.example .env.local     # แล้วใส่ค่าจริง
npm run db:migrate
npm run db:seed
node scripts/create-staff.mjs "ชื่อพนักงาน" 246810 staff main
npm run dev
```

ต้องมี `psql` ในเครื่องสำหรับคำสั่ง `db:*` (macOS: `brew install libpq` แล้วเพิ่ม PATH
หรือ `brew install postgresql@16`)

## สิ่งที่ต้องเตรียมก่อน

1. **โปรเจกต์ Supabase** — เอา connection string มาใส่ `DATABASE_URL`
   และสร้าง bucket ชื่อ `receipts` สำหรับเก็บรูปใบเสร็จเดลิเวอรี่
2. **LINE Official Account** + Messaging API channel
3. **LINE Login channel + LIFF app** — ตั้ง size เป็น `Full`, เปิด `Scan QR`,
   scope `profile` และ `openid`

## สถานะปัจจุบัน

| ส่วน | สถานะ |
|---|---|
| Schema + constraint (§8) | ✅ เสร็จ |
| ตรรกะแกนใน Postgres (§5) | ✅ เสร็จ — สะสม + แลกของรางวัลครบ |
| สัญญา API (§14) | ✅ เสร็จ |
| Auth ตรวจ LIFF token + PIN พนักงาน | ✅ เสร็จ |
| API routes | ✅ เสร็จ — ลูกค้า 4 เส้น พนักงาน 8 เส้น |
| หน้าจอลูกค้า (LIFF) | ⬜ ยังไม่เริ่ม |
| เว็บพนักงาน | ⬜ ยังไม่เริ่ม |
| หน้าแอดมิน + คิวอนุมัติเดลิเวอรี่ | ⬜ ยังไม่เริ่ม |
| LINE webhook รับรูปใบเสร็จ | ⬜ ยังไม่เริ่ม |

## ทดสอบตรรกะแกนโดยยังไม่มีหน้าเว็บ

```sql
-- สร้างลูกค้าทดสอบ
INSERT INTO customers (line_user_id, display_name)
VALUES ('U_test_001', 'ลูกค้าทดสอบ') RETURNING id;

-- ออก QR หนึ่งใบ
INSERT INTO earn_tokens (code, branch_id, expires_at)
SELECT 'TESTCODE00000001', id, now() + interval '10 minutes'
  FROM branches WHERE code = 'main';

-- ลูกค้าสแกน
SELECT claim_earn_token('<customer_id>', 'TESTCODE00000001');

-- สแกนซ้ำ — ต้องได้ ok:false reason:already_claimed_by_you
SELECT claim_earn_token('<customer_id>', 'TESTCODE00000001');

-- ดูสถานะบัตรแบบพร้อมวาด
SELECT jsonb_pretty(get_card_state('<customer_id>'));
```

ปั๊มให้ครบ 5 ดวงแล้วดูว่า `entitlements` โผล่มาเอง และครบ 10 ดวงแล้วบัตรปิด
พร้อมเปิดใบใหม่ให้อัตโนมัติ

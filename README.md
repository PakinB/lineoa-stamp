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

1. **โปรเจกต์ Supabase** — ดูหัวข้อ "Supabase ต้องตั้งอะไรบ้าง" ด้านล่าง
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
| เว็บพนักงาน | ✅ เสร็จ — เข้ากะ · ออก QR · รับรางวัล · สรุปกะ |
| หน้าจอลูกค้า | ✅ เสร็จ — บัตร · ผลสแกน · เลือกรางวัล · ยินยอม PDPA |
| หน้าแอดมิน (ภาพรวม · พนักงาน · ของรางวัล · ตั้งค่า) | ✅ เสร็จ |
| คิวอนุมัติรูปเดลิเวอรี่ | ⬜ ยังไม่เริ่ม |
| ตั้งค่า deploy ขึ้น Cloudflare | ✅ พร้อม รอบัญชี Cloudflare |
| LINE webhook รับรูปใบเสร็จ | ⬜ ยังไม่เริ่ม |
| ล็อกอินพนักงานแบบเลือกชื่อ + ล็อกเมื่อเดาผิด | ✅ เสร็จ |
| สรุป QR รายวัน + รายงาน Excel (แยกสาขา · นับดวงจริง · จัดรูปแบบครบ) | ✅ เสร็จ |

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


## ทดสอบหน้าลูกค้าโดยยังไม่ต้องตั้ง LINE

ตั้งสองค่านี้ใน `.env.local` แล้วจะเข้าหน้าลูกค้าได้เลย ไม่ต้องผ่าน LINE

```
DEV_FAKE_LINE_USER=U_dev_pakin
DEV_FAKE_LINE_NAME=คุณทดสอบ
NEXT_PUBLIC_BASE_URL=http://<IP ในวง LAN>:3000
NEXT_PUBLIC_LIFF_ID=            # ปล่อยว่างหรือใส่ 0000000000-xxx
```

เมื่อยังไม่ได้ตั้ง LIFF ตัว QR จะชี้กลับมาที่เว็บเราเองแทน `liff.line.me`
สแกนด้วยกล้องมือถือธรรมดาก็เข้าได้ (ต้องอยู่ WiFi วงเดียวกัน และรัน
`npm run dev -- -H 0.0.0.0` เพื่อให้เครื่องอื่นเข้าถึงได้)

> ทางลัดนี้ทำงานเฉพาะตอนไม่ใช่ production **และ** ต้องตั้ง `DEV_FAKE_LINE_USER` เอง
> บนเซิร์ฟเวอร์จริงจะไม่ทำงานแม้เผลอตั้งค่าไว้ เพราะ `NODE_ENV` เป็น production เสมอ

## Supabase ต้องตั้งอะไรบ้าง

**ไม่ได้ deploy โค้ดขึ้น Supabase เลย** ใช้เป็นแค่ Postgres ที่มีคนดูแลให้
กับที่เก็บไฟล์ โค้ดทั้งหมดรันอยู่ที่ Next.js และต่อฐานข้อมูลด้วยไดรเวอร์
Postgres มาตรฐาน ไม่ได้ใช้ Supabase SDK สักตัว

### ต้องทำ 3 อย่าง

1. **สร้าง project** — ในฟอร์มมี 4 ช่อง

   | ช่อง | ใส่อะไร |
   |---|---|
   | Organization | เลือกอันที่มี หรือสร้างใหม่ ชื่ออะไรก็ได้ |
   | Project name | `mala-stamp` (ไม่มีผลทางเทคนิค) |
   | Database Password | กด **Generate a password** แล้ว **Copy เก็บไว้ทันที** |
   | Region | `Southeast Asia (Singapore)` — ใกล้ไทยที่สุด |

   **Database Password คือช่องที่พลาดแล้วเจ็บ** มันจะกลายเป็นส่วนหนึ่งของ
   `DATABASE_URL` และ Supabase ไม่โชว์ให้ดูอีกหลังสร้างเสร็จ ถ้าทำหาย
   ต้องไปกด reset แล้วตามแก้ทุกที่ที่ใช้ค่านี้

   Region เลือกผิดแก้ทีหลังไม่ได้ ต้องสร้าง project ใหม่แล้วย้ายข้อมูล
   ระยะทางมีผลจริงเพราะลูกค้ายืนรออยู่หน้าเคาน์เตอร์ตอนสแกน
2. **เอา connection string** — กดปุ่ม **Connect** ที่แถบบนสุดของหน้า project
   **ไม่ได้อยู่ใน Settings** (Supabase ย้ายออกมาแล้ว ในเมนู Settings จะไม่มีคำว่า Database)
   ในหน้าต่างที่เด้งขึ้นมา เลือกแท็บ **Transaction pooler** พอร์ต `6543`
3. **รัน migration** — `npm run db:migrate && npm run db:seed`
   หรือถ้าไม่มี `psql` ในเครื่อง ก๊อปเนื้อไฟล์ใน `db/` ไปวางใน SQL Editor
   ของ Supabase แล้วรันตามลำดับ `0001` → `0002` → `seed.sql`
4. **สร้าง bucket ชื่อ `receipts`** ตั้งเป็น private — เก็บรูปใบเสร็จเดลิเวอรี่
   (ยังไม่ต้องทำจนกว่าจะเริ่มทำฟีเจอร์เดลิเวอรี่)

### ไม่ต้องทำ

| ฟีเจอร์ของ Supabase | ทำไมไม่ใช้ |
|---|---|
| Auth | ลูกค้าใช้ LINE Login พนักงานใช้ PIN ของเราเอง |
| Row Level Security | เบราว์เซอร์ไม่เคยคุยกับ Supabase ตรง ๆ ทุกอย่างผ่าน API ของเรา |
| Edge Functions | ตรรกะอยู่ในฟังก์ชัน Postgres และ API ของ Next.js แล้ว |
| Realtime | จอพนักงานใช้ poll ทุก 2 วินาที พอที่สเกลนี้ |
| PostgREST (auto API) | ต่อ Postgres ตรงด้วย `lib/db.ts` |

> **ข้อสำคัญเรื่องความปลอดภัย:** เพราะเราต่อฐานข้อมูลด้วยสิทธิ์เต็ม
> และไม่ได้ใช้ RLS สิ่งเดียวที่ปกป้องข้อมูลคือการตรวจสิทธิ์ใน API ของเราเอง
> **ห้ามเอา `DATABASE_URL` ไปไว้ฝั่งเบราว์เซอร์เด็ดขาด** และห้ามตั้งชื่อ
> ตัวแปรขึ้นต้นด้วย `NEXT_PUBLIC_` เพราะ Next.js จะฝังลงไปในบันเดิลให้ทุกคนเห็น

### ข้อจำกัดชั้นฟรีที่ควรรู้

- **ฐานข้อมูล 500 MB** — ที่ขนาด 5 สาขาใช้ไปได้หลายปี รายการสแตมป์แถวหนึ่ง
  ไม่ถึงหนึ่งกิโลไบต์
- **ที่เก็บไฟล์ 1 GB** — รูปใบเสร็จราว 200 KB ต่อใบ = เก็บได้ราว 5,000 ใบ
  ถ้าเดลิเวอรี่วันละ 20 ใบจะเต็มในราว 8 เดือน แก้ได้โดย**ย่อรูปก่อนอัปโหลด**
  และ**ลบรูปที่อนุมัติแล้วเกิน 90 วัน** — ลบได้เพราะสิ่งที่กันส่งรูปซ้ำคือ
  `image_hash` ไม่ใช่ตัวไฟล์
- **project หยุดเองเมื่อไม่มีการใช้งานราวหนึ่งสัปดาห์**
  แก้แล้วด้วย Worker `lami-keepalive` ที่แตะฐานข้อมูลวันละครั้ง (ดูด้านล่าง)

## กัน Supabase หยุดเอง

Worker แยกชื่อ `lami-keepalive` อยู่ที่ `workers/keepalive/`
ตั้ง cron ไว้ `0 3 * * *` (10:00 น. บ้านเรา) ต่อ Hyperdrive ตัวเดียวกับแอปหลัก
แล้วยิง `SELECT count(*) FROM branches` วันละครั้ง

```bash
cd workers/keepalive && npx wrangler deploy     # deploy
curl https://lami-keepalive.<subdomain>.workers.dev   # ยิงเองโดยไม่รอ cron
```

ผลต่อโควตา: 1 คำขอ/วัน จากเพดาน 100,000/วัน และ 1 คิวรี/วันจากเพดาน
Hyperdrive 100,000/วัน — แทบไม่นับ

**แยกเป็น Worker ต่างหากโดยตั้งใจ** เพราะแอปหลักสร้างจาก OpenNext ซึ่งกำหนด
ตัว entry เอง การแทรก scheduled handler เข้าไปจะเปราะเวลาอัปเดตเวอร์ชัน

> ⚠️ **กันหยุดได้ แต่ปลุกเองไม่ได้** ถ้าหยุดไปแล้วต้องเข้า dashboard กดปลุกด้วยมือ
> และ Worker เรียก Worker ด้วยกันบน workers.dev ไม่ได้ (error 1042)
> ตัวนี้จึงต่อฐานข้อมูลตรง ไม่ผ่าน URL ของแอปหลัก


## deploy ขึ้น Cloudflare Workers

ตั้งค่าไว้ครบแล้ว เหลือขั้นที่ต้องใช้บัญชีจริง

```bash
npx wrangler login                    # เปิดเบราว์เซอร์ให้ยืนยันตัวตน

# สร้าง Hyperdrive ชี้ไป Supabase (เอา DATABASE_URL จาก .env.local มาใส่)
npx wrangler hyperdrive create lami-db --connection-string="postgresql://..."
# เอา id ที่ได้ไปแทน PLACEHOLDER ใน wrangler.jsonc

# ใส่ค่าลับ (ไม่เก็บในไฟล์)
npx wrangler secret put SESSION_SECRET
npx wrangler secret put LINE_LOGIN_CHANNEL_ID

npm run cf:deploy
```

ค่าที่ขึ้นต้นด้วย `NEXT_PUBLIC_` ต้องมีตอน build ไม่ใช่ตอนรัน จึงใส่ใน
`.env.local` หรือส่งเป็นตัวแปรแวดล้อมตอนสั่ง `cf:build`

### ทดลองรันในรันไทม์ของ Workers บนเครื่องก่อน

```bash
set -a && . ./.env.local && set +a
WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$DATABASE_URL" npm run cf:preview
```

เปิด `localhost:8787` — ตัวนี้รันด้วยเครื่องยนต์เดียวกับของจริง ใช้ตรวจว่า
โค้ดทำงานบน Workers ได้ก่อนจะ deploy จริง

> ในโหมดนี้ `NODE_ENV` เป็น production ทางลัด `DEV_FAKE_LINE_USER` จึงปิดเอง
> หน้าลูกค้าจะตอบ `unauthenticated` ซึ่งถูกต้องแล้ว


## ข้อควรรู้เมื่อรันบน Cloudflare Workers

สี่เรื่องนี้ทำให้เสียเวลาไปมากตอนขึ้นครั้งแรก บันทึกไว้กันลืม

**1. Hyperdrive ต้องชี้ไป session pooler (พอร์ต 5432) ไม่ใช่ transaction pooler (6543)**
ถ้าชี้ไป 6543 จะกลายเป็น pooler ซ้อน pooler แล้ว Hyperdrive จะปิดคอนเนกชันทิ้ง
อาการคือ `write CONNECTION_CLOSED ...hyperdrive.local` แบบสุ่ม ๆ

**2. หนึ่งคำขอต้องยิง SQL คำสั่งเดียว**
Workers ผูก I/O ไว้กับคำขอที่สร้างมัน เปิดตัวเชื่อมสองตัวในคำขอเดียวจะล้มเหลว
ตรรกะที่ต้องยิงหลายคำสั่งจึงรวมไว้เป็นฟังก์ชันเดียวใน `db/migrations/0003_api.sql`

**3. PBKDF2 เกิน 100,000 รอบไม่ได้**
Workers ปฏิเสธค่าที่สูงกว่านั้น และ hash เดิมฝังเลขรอบไว้ในตัว
ถ้าเปลี่ยนค่านี้ต้องออก PIN ใหม่ให้พนักงานทุกคน

**4. ห้ามใช้ `require()` อ่าน binding**
ในบันเดิลของ Worker `require` ใช้ไม่ได้ แล้วจะเงียบ ๆ ตกไปใช้ `DATABASE_URL`
ที่ถูกฝังตอน build ทำให้ต่อฐานข้อมูลตรงโดยไม่ผ่าน Hyperdrive แล้วค้าง

### deploy

```bash
set -a && . ./.env.local && set +a
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$DATABASE_URL"
export NEXT_PUBLIC_BASE_URL="https://<โดเมนจริง>"   # NEXT_PUBLIC_* ถูกฝังตอน build
npm run cf:build && npx wrangler deploy
```


## ขั้นตอนเชื่อมกับ LINE

ทำตามลำดับนี้ ข้ามขั้นไม่ได้เพราะแต่ละขั้นต้องใช้ค่าจากขั้นก่อนหน้า

### ขั้นที่ 1 — สร้าง LINE Official Account

สมัครที่ LINE for Business (ฟรี) หรือสร้างจาก LINE Developers Console ก็ได้
ใช้บัญชี LINE ส่วนตัวสมัครได้เลย ยังไม่ต้องยืนยันตัวตนธุรกิจ

### ขั้นที่ 2 — สร้าง Provider

ที่ [developers.line.biz](https://developers.line.biz/console/) สร้าง Provider หนึ่งอัน
เช่นชื่อ `La-Mi` — เป็นแค่กล่องไว้ใส่ channel **ทั้งสอง channel ต้องอยู่ใน Provider เดียวกัน**

### ขั้นที่ 3 — สร้าง Messaging API channel

ผูกกับ LINE OA ที่สร้างไว้ในขั้นที่ 1

ยังไม่ต้องเอาค่าอะไรมาใช้ตอนนี้ — จะได้ใช้ตอนทำ webhook รับรูปใบเสร็จเดลิเวอรี่
และตอนส่งข้อความเมื่อลูกค้าถึง checkpoint

### ขั้นที่ 4 — สร้าง LINE Login channel

**คนละอันกับขั้นที่ 3** ตั้ง App type เป็น Web app

จากหน้า Basic settings เอา **Channel ID** (ตัวเลขล้วน) มาเก็บไว้
→ ค่านี้คือ `LINE_LOGIN_CHANNEL_ID`

### ขั้นที่ 5 — สร้าง LIFF app

อยู่ใน **แท็บ LIFF ของ LINE Login channel** (ขั้นที่ 4) ไม่ใช่ของ Messaging API

| ช่อง | ใส่ |
|---|---|
| Endpoint URL | `https://<โดเมนจริง>/card` |
| Size | `Full` |
| Scopes | `profile` และ `openid` |
| Scan QR | เปิด |

เสร็จแล้วจะได้ **LIFF ID** หน้าตาแบบ `1656789012-AbCdEfGh` (มีขีดกลาง)
→ ค่านี้คือ `NEXT_PUBLIC_LIFF_ID`

### ขั้นที่ 6 — ใส่ค่าแล้ว deploy

```bash
npx wrangler secret put LINE_LOGIN_CHANNEL_ID      # ค่าจากขั้นที่ 4

set -a && . ./.env.local && set +a
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$DATABASE_URL"
export NEXT_PUBLIC_LIFF_ID="<ค่าจากขั้นที่ 5>"
export NEXT_PUBLIC_BASE_URL="https://<โดเมนจริง>"
npm run cf:build && npx wrangler deploy
```

`NEXT_PUBLIC_*` ถูกฝังตอน build จึงต้องส่งตอนสั่ง build ไม่ใช่ตั้งเป็น secret

### ขั้นที่ 7 — ริชเมนูและข้อความตอบกลับ

ทำใน LINE OA Manager ไม่ต้องเขียนโค้ด (§14 — งานของคนที่ไม่แตะโค้ด)
ปุ่มริชเมนูชี้ไป `https://liff.line.me/<LIFF_ID>`

### จุดที่พลาดกันบ่อย

- **LIFF ID กับ Channel ID เป็นคนละค่า** — LIFF ID มีขีดกลาง Channel ID เป็นตัวเลขล้วน
- **LIFF อยู่ใต้ LINE Login ไม่ใช่ Messaging API** — สร้างผิด channel จะหาแท็บ LIFF ไม่เจอ
- **Endpoint URL ต้องเป็น https และลงท้ายด้วย `/card`** — LINE ไม่รับ http แม้ตอนพัฒนา
- **ต้องมีโค้ดฝั่งเว็บเรียก LIFF SDK ด้วย** — ตั้งค่าใน console อย่างเดียวไม่พอ

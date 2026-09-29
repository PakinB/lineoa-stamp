# ไฟล์ภาพของร้าน

```
brand/
  stampbgnew1.jpg     ต้นฉบับบัตรสะสมที่ใช้อยู่ 960x640
  stampbgnew1.webp    ที่ใช้จริง 97 KB
  stampbg.png         บัตรใบเก่า 1537x1023 (เก็บอ้างอิง ไม่ได้ใช้แล้ว)
  stampbg.webp        บัตรใบเก่า
  stampcomplete.png   ต้นฉบับตราประทับ 1254x1254
  stampcomplete.webp  ที่ใช้จริง 400px 64 KB
```

ใช้ webp เพราะลูกค้าเปิดบัตรตอนยืนรออยู่หน้าเคาน์เตอร์ — PNG ต้นฉบับรวมกัน 3.8 MB
แปลงแล้วเหลือ 192 KB

---

## เปลี่ยนรูปบัตร (stampbg) ต้องแก้ 4 ที่

### 1. วางไฟล์ใหม่แล้วแปลงเป็น webp

```bash
# วางไฟล์ใหม่ทับที่ public/brand/stampbg.png ก่อน แล้วสั่ง
python3 -c "
from PIL import Image
im = Image.open('public/brand/stampbg.png'); im.thumbnail((1100,1100), Image.LANCZOS)
im.save('public/brand/stampbg.webp','webp',quality=86,method=6)"
```

**ถ้าตำแหน่งช่องกับสัดส่วนภาพเหมือนเดิมเป๊ะ จบแค่ขั้นนี้** ข้อ 2–4 ไม่ต้องแตะ

### 2. วัดตำแหน่งช่องใหม่

```bash
python3 scripts/measure-card.py public/brand/stampbg.png
```

สคริปต์จะพิมพ์ขอบที่ตรวจเจอออกมาเป็นเปอร์เซ็นต์ ให้จับคู่เป็นกล่อง 5 ใบเอง
(ไม่ได้เดาให้อัตโนมัติ เพราะเดาผิดแล้วตราประทับจะเยื้องโดยไม่มีอะไรเตือน)

### 3. ใส่ค่าใหม่ที่ `components/StampCard.tsx`

```ts
const COL = [13.6, 31.78, 49.9, 68.12, 86.3];   // จุดกึ่งกลางแนวนอนของ 5 คอลัมน์
const ROW = [56.94, 79.91];                      // จุดกึ่งกลางแนวตั้งของ 2 แถว
```

### 4. ใส่ค่าใหม่ที่ `app/globals.css`

```css
.lami       { aspect-ratio: 1537 / 1023; }   /* สัดส่วนภาพใหม่ */
.lami .mark { width: 13.6%; }                /* ราว 82% ของความกว้างกล่อง */
```

### ตรวจก่อน deploy

ประกอบภาพตัวอย่างดูว่าตราประทับลงตรงช่องจริงไหม — คำสั่งอยู่ท้ายผลลัพธ์ของ
`measure-card.py` ผลจะออกที่ `/tmp/check.png`

**อย่าข้ามขั้นนี้** เพราะตำแหน่งเยื้องนิดเดียวจะเห็นชัดมากบนจอมือถือ

---

## ถ้าเปลี่ยนสีของแบรนด์ด้วย

สีทั้งระบบอยู่ที่ `app/globals.css` บนสุด แก้ที่เดียวเปลี่ยนทั้งเว็บ

```css
--brand   #2B86BC   น้ำเงินหลัก (ปุ่ม หัวข้อ)
--ground  #FBF1E5   ครีมพื้นหลัง
--stamp   #DB0100   แดงตราประทับ (ใช้เฉพาะตอนฉลอง)
```

ดูดสีจากภาพใหม่ได้ด้วย:

```bash
python3 -c "
from PIL import Image
from collections import Counter
im = Image.open('public/brand/stampbg.png').convert('RGB'); px = im.load()
c = Counter(px[x,y] for y in range(200,300) for x in range(950,1400))
print('#%02X%02X%02X' % c.most_common(1)[0][0])"
```

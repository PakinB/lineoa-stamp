# ไฟล์ภาพของร้าน

```
brand/
  stampbg.png        ต้นฉบับบัตรสะสม 1537x1023 (เก็บไว้อ้างอิง ไม่ได้ใช้บนเว็บ)
  stampbg.webp       ที่ใช้จริง 1100px 128 KB
  stampcomplete.png  ต้นฉบับตราประทับ 1254x1254
  stampcomplete.webp ที่ใช้จริง 400px 64 KB
```

## ถ้าเปลี่ยนไฟล์บัตร ต้องแก้อะไรบ้าง

ตำแหน่งตราประทับใน `components/StampCard.tsx` วัดจากไฟล์ต้นฉบับ
ขนาด 1537x1023 แล้วแปลงเป็นเปอร์เซ็นต์ ถ้าเปลี่ยนภาพบัตรที่มีตำแหน่งช่องต่างไป
ต้องวัดใหม่และแก้ค่า `COL` `ROW` กับ `aspect-ratio` ของ `.lami` ใน `app/globals.css`

## แปลงไฟล์ใหม่

```bash
python3 -c "
from PIL import Image
im = Image.open('public/brand/stampbg.png'); im.thumbnail((1100,1100), Image.LANCZOS)
im.save('public/brand/stampbg.webp','webp',quality=86,method=6)"
```

ใช้ webp เพราะลูกค้ายืนรออยู่หน้าเคาน์เตอร์ตอนเปิดบัตร — ไฟล์ PNG ต้นฉบับ
รวมกัน 3.8 MB แปลงแล้วเหลือ 192 KB

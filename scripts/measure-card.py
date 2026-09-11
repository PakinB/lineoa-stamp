#!/usr/bin/env python3
"""
ช่วยวัดตำแหน่งช่องสแตมป์จากไฟล์การ์ด

    python3 scripts/measure-card.py public/brand/stampbg.png

พิมพ์ขอบที่ตรวจเจอออกมาเป็นเปอร์เซ็นต์ ให้เอาไปจับคู่เป็นกล่องเอง
ไม่ได้เดาให้อัตโนมัติ เพราะการ์ดแต่ละแบบมีเส้นประด้านในบ้างไม่มีบ้าง
เดาผิดแล้วตราประทับจะเยื้องโดยไม่มีอะไรเตือน

ต้องมี Pillow:  pip3 install Pillow
"""
import sys
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else "public/brand/stampbg.png"
im = Image.open(path).convert("RGB")
W, H = im.size
px = im.load()


def bluish(p):
    """ขอบกล่องของการ์ด La-Mi เป็นสีฟ้าบนพื้นครีม — การ์ดสีอื่นต้องแก้ตรงนี้"""
    r, g, b = p
    return b > r + 18 and b > 110


def runs(hits, threshold):
    out, run = [], None
    for i, n in enumerate(hits):
        if n >= threshold:
            if run is None:
                run = i
        else:
            if run is not None and i - run >= 2:
                out.append((run + i) // 2)
            run = None
    return out


print(f"ภาพ: {W} x {H}   aspect-ratio: {W} / {H}\n")

# ---- ขอบแนวนอน (บน/ล่างของแต่ละแถว) ----
hy = [sum(1 for x in range(int(W * .05), int(W * .95), 3) if bluish(px[x, y]))
      for y in range(H)]
ey = [y for y in runs(hy, max(hy) * .45) if H * .35 < y < H * .97]
print("ขอบแนวนอนที่เจอ (px / %):")
print("  " + "  ".join(f"{y}({y / H * 100:.1f}%)" for y in ey))

# ---- ขอบแนวตั้ง สแกนแถบแคบ ๆ ในแถวแรก ----
if len(ey) >= 2:
    top, bottom = ey[0], ey[1]
    band = range(top + (bottom - top) // 5, top + (bottom - top) // 2)
else:
    band = range(int(H * .48), int(H * .53))

hx = [sum(1 for y in band if bluish(px[x, y])) for x in range(W)]
ex = runs(hx, len(band) * .55)
print("\nขอบแนวตั้งที่เจอ (px / %):")
print("  " + "  ".join(f"{x}({x / W * 100:.1f}%)" for x in ex))

print(f"""
── วิธีอ่าน ──
ขอบมักมาเป็นคู่ ๆ (ขอบนอกกับเส้นประด้านใน) ให้จับเป็นกล่อง 5 ใบ
แล้วคำนวณจุดกึ่งกลางของแต่ละกล่อง

  COL[i] = (ซ้ายกล่อง + ขวากล่อง) / 2 / {W} * 100
  ROW[0] = (บนแถว1 + ล่างแถว1) / 2 / {H} * 100
  ROW[1] = (บนแถว2 + ล่างแถว2) / 2 / {H} * 100

เอาไปใส่ที่ components/StampCard.tsx
ส่วนขนาดตราประทับ .lami .mark ใน app/globals.css ให้ราว 82% ของความกว้างกล่อง

── ตรวจก่อนใช้จริง ──
ประกอบภาพตัวอย่างดูว่าตรงจริงไหม ก่อนเอาเข้าโค้ด:

python3 -c "
from PIL import Image
bg = Image.open('{path}').convert('RGBA')
mk = Image.open('public/brand/stampcomplete.webp').convert('RGBA')
W, H = bg.size
COL = [13.6, 31.78, 49.9, 68.12, 86.3]   # <- ใส่ค่าใหม่
ROW = [56.94, 79.91]                      # <- ใส่ค่าใหม่
s = int(W * 0.136); mk = mk.resize((s, s), Image.LANCZOS)
for n in range(1, 11):
    i = n - 1
    bg.alpha_composite(mk, (int(W*COL[i%5]/100)-s//2, int(H*ROW[i//5]/100)-s//2))
bg.convert('RGB').save('/tmp/check.png'); print('ดูที่ /tmp/check.png')"
""")

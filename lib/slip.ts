"use client";

/**
 * เตรียมรูปสลิปก่อนส่งขึ้นเซิร์ฟเวอร์
 *
 * รูปจากกล้องมือถือใบหนึ่ง 3–4 MB ย่อแล้วเหลือราว 80 KB ซึ่งยังอ่านตัวเลขออกสบาย
 * สำคัญสองเรื่อง — ลูกค้าไม่ต้องยืนรออัปโหลดบนเน็ตมือถือ และที่เก็บอยู่ได้หลายปี
 * แทนที่จะเป็นหลายเดือน
 */
export async function shrinkImage(file: File, maxSide = 1280, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ย่อรูปไม่ได้");
  ctx.drawImage(bitmap, 0, 0, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/**
 * อ่านเลขอ้างอิงจาก QR ท้ายสลิป
 *
 * ใช้กัน "ส่งสลิปใบเดิมซ้ำ" ซึ่งเป็นการโกงที่เจอบ่อยที่สุดในชีวิตจริง
 * **ไม่ได้ยืนยันว่าเงินเข้าจริง** ตัวนั้นพนักงานดูจากแอปธนาคารเท่านั้น
 * อ่านไม่ได้ก็ไม่เป็นไร ส่งสลิปต่อได้ แต่หน้าพนักงานจะขึ้นเตือนให้ดูละเอียดขึ้น
 */
export async function readSlipRef(file: File): Promise<string | null> {
  try {
    const jsQR = (await import("jsqr")).default;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data.data, data.width, data.height)?.data ?? null;
  } catch {
    return null;
  }
}

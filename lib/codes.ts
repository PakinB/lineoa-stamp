/**
 * รหัสสำหรับ QR — Base32 ที่ตัดตัวอักษรกำกวมออก (ไม่มี 0 1 I L O U)
 *
 * 16 ตัว × 5 บิต = 80 บิต เดาไม่ได้ในทางปฏิบัติ
 * ไม่เรียงลำดับ ไม่มีความหมายในตัวเอง ความปลอดภัยอยู่ฝั่งเซิร์ฟเวอร์ทั้งหมด
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newCode(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** ลิงก์ที่ฝังใน QR — สแกนด้วยกล้อง LINE แล้วเปิด LIFF ได้เลย */
export function liffUrl(params: Record<string, string>): string {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!id) throw new Error("ไม่พบ NEXT_PUBLIC_LIFF_ID");
  return `https://liff.line.me/${id}?${new URLSearchParams(params)}`;
}

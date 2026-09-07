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

/**
 * ลิงก์ที่ฝังใน QR
 *
 * ปกติชี้ไป liff.line.me เพื่อให้สแกนด้วยกล้อง LINE แล้วเปิด LIFF ล็อกอินอัตโนมัติ
 *
 * ถ้ายังไม่ได้ตั้ง LIFF (ปล่อย NEXT_PUBLIC_LIFF_ID ว่าง) จะชี้กลับมาที่เว็บเราเอง
 * เพื่อให้สแกนทดสอบด้วยกล้องมือถือธรรมดาได้ระหว่างพัฒนา
 * ต้องตั้ง NEXT_PUBLIC_BASE_URL เป็น IP ในวง LAN มือถือถึงจะเข้าถึงได้
 */
export function liffUrl(params: Record<string, string>): string {
  const id = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
  const qs = new URLSearchParams(params).toString();

  if (!id || id.startsWith("0000000000")) {
    const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return `${base}/card?${qs}`;
  }
  return `https://liff.line.me/${id}?${qs}`;
}

/**
 * สร้างสายอักขระสำหรับ QR พร้อมเพย์ล็อคยอด
 *
 * เขียนเองไม่ใช้ไลบรารีภายนอก เพราะมาตรฐาน EMVCo เป็นแค่การต่อ TLV แล้วปิดท้าย
 * ด้วย CRC16 — สั้นกว่าการพาไลบรารีเข้ามาในบันเดิลของ Worker และตรวจสอบเองได้
 *
 * **สร้างในเครื่องทั้งหมด ไม่ผ่านตัวกลาง** จึงไม่เสียค่าธรรมเนียม 1.5–1.8%
 * ตามที่เคาะไว้ใน docs/pos-design.md §1 และใช้ซ้ำกับเดลิเวอรี่
 */

/** TLV: id + ความยาว 2 หลัก + ค่า */
function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

/**
 * CRC-16/CCITT-FALSE — poly 0x1021 ค่าเริ่ม 0xFFFF
 * ค่าตรวจมาตรฐาน: crc16("123456789") === 0x29B1
 */
export function crc16(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * แปลงเบอร์โทรไทยเป็นรูปแบบที่พร้อมเพย์ใช้
 * 081-234-5678 → 0066812345678 (ตัด 0 หน้า เติมรหัสประเทศ 66 แล้วเติมศูนย์ให้ครบ 13)
 */
export function promptPayTarget(phoneOrId: string): string {
  const d = phoneOrId.replace(/\D/g, "");
  if (d.length === 13) return d;                       // เลขบัตรประชาชน
  if (d.length === 15) return d;                       // e-wallet

  // กรอกมาแบบมีรหัสประเทศแล้ว (66XXXXXXXXX) ห้ามเติม 66 ซ้ำ
  // ถ้าพลาดตรงนี้ QR จะชี้ไปบัญชีที่ไม่มีอยู่จริงและเงินไม่เข้าใคร
  const local = d.startsWith("66") && d.length === 11 ? d.slice(2) : d.replace(/^0/, "");
  return ("0000000000000" + "66" + local).slice(-13);
}

/**
 * สายอักขระที่เอาไปทำเป็นภาพ QR
 *
 * ใส่ยอดเงินเสมอ (ล็อคยอด) ลูกค้าจึงโอนผิดจำนวนไม่ได้ และตั้ง Point of Initiation
 * เป็น 12 = ใช้ครั้งเดียว ไม่ใช่ป้าย QR ถาวรหน้าร้าน
 */
export function promptPayPayload(phoneOrId: string, amount: number): string {
  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("29", tlv("00", "A000000677010111") + tlv("01", promptPayTarget(phoneOrId))) +
    tlv("53", "764") +
    tlv("54", amount.toFixed(2)) +
    tlv("58", "TH");

  const toCheck = body + "6304";
  return toCheck + crc16(toCheck).toString(16).toUpperCase().padStart(4, "0");
}

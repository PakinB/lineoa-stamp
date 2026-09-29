import { sql } from "@/lib/db";

/**
 * ค่าตั้งค่าจากตาราง app_settings
 *
 * §6: ห้ามฝังตัวเลขกันโกงเป็นค่าคงที่ในโค้ด เจ้าของต้องปรับเองได้จากหน้าแอดมิน
 * ค่า null ในฐานข้อมูลแปลว่า "ไม่จำกัด" — ต้องรองรับให้ถูกทุกที่ที่เรียกใช้
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await sql<{ value: unknown }[]>`
    SELECT value FROM app_settings WHERE key = ${key}`;
  if (rows.length === 0 || rows[0].value === null) return fallback;
  return rows[0].value as T;
}

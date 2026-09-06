import postgres from "postgres";

/**
 * ตัวเชื่อมฐานข้อมูล — ใช้ไดรเวอร์บาง ๆ ไม่ใช้ ORM
 *
 * เหตุผล: ตรรกะแกนกลางอยู่ในฟังก์ชันของ Postgres (db/migrations/0002_functions.sql)
 * เพราะต้องการล็อกแถวและทรานแซกชันที่ควบคุมได้แม่นยำ ORM จะบังหน้าส่วนนั้น
 * และทำให้เผลอเขียนโค้ดที่ไม่ atomic ได้ง่าย
 */
declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env.local ก่อน");
  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    // Supabase pooler ต้องปิด prepared statements
    prepare: false,
  });
}

// hot reload ของ Next.js สร้าง instance ซ้ำ เก็บไว้ใน global กัน connection รั่ว
export const sql = global.__sql ?? connect();
if (process.env.NODE_ENV !== "production") global.__sql = sql;

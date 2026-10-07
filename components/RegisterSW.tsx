"use client";

import { useEffect } from "react";

/**
 * ลงทะเบียน service worker — ใช้เฉพาะฝั่งพนักงาน
 *
 * ตัว sw.js ไม่แคชอะไรเลย มีไว้ให้ Chrome บน Android ยอมติดตั้งเป็นแอปจริง
 * ที่เปิดเต็มจอ (ดูคอมเมนต์ยาวใน public/sw.js)
 *
 * **ไม่ลงทะเบียนตอนอยู่ในเว็บวิวของ LINE** หน้าลูกค้าเปิดผ่าน LIFF ซึ่งติดตั้ง
 * เป็นแอปไม่ได้อยู่แล้ว การไปยุ่งกับมันมีแต่ความเสี่ยง ไม่มีประโยชน์
 */
export default function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (/\bLine\//i.test(navigator.userAgent)) return;

    // ล้มเหลวก็ไม่ต้องทำอะไร เว็บยังใช้งานได้ตามปกติทุกอย่าง
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}

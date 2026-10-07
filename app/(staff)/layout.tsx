import type { Metadata } from "next";
import RegisterSW from "@/components/RegisterSW";

/**
 * เปลือกของฝั่งพนักงาน — ที่เดียวที่ผูก manifest กับ meta ของ iOS
 *
 * **ตั้งใจไม่ใช้ app/manifest.ts ของ Next.js** เพราะมันจะแทรก
 * <link rel="manifest"> ลงทุกหน้ารวมถึงหน้าบัตรลูกค้า แล้ว manifest ตัวนี้มี
 * start_url เป็น /staff — ถ้าลูกค้าเผลอเปิดหน้าบัตรในเบราว์เซอร์ปกติ
 * Chrome จะชวนติดตั้ง "แอปพนักงาน" ให้ ซึ่งผิดทาง
 *
 * วางไว้ชั้นนี้ไม่ใช่ใต้ (app) เพราะพนักงานต้องติดตั้งได้ตั้งแต่หน้าใส่ PIN
 * ซึ่งอยู่นอกกลุ่มที่ต้องล็อกอินแล้ว
 */
export const metadata: Metadata = {
  title: "La-Mi พนักงาน",
  manifest: "/staff.webmanifest",
  appleWebApp: {
    capable: true,
    title: "La-Mi",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  /*
   * Next.js ใส่ให้แค่ `mobile-web-app-capable` ซึ่งเป็นชื่อมาตรฐานตัวใหม่
   * Safari เพิ่งมารองรับตอน iOS 16.4 — iPhone ที่เก่ากว่านั้นยังต้องใช้ชื่อเดิม
   * ของ Apple ไม่งั้นกดเปิดจากหน้าจอโฮมแล้วได้แถบ Safari มาด้วย ไม่เต็มจอ
   */
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export default function StaffShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RegisterSW />
    </>
  );
}

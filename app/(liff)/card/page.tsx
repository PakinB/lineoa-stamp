import { Suspense } from "react";
import CustomerCard from "@/components/CustomerCard";

/**
 * หน้าเดียวรับได้ทุกทาง เพราะ LIFF ตั้ง Endpoint URL ได้อันเดียว
 *   /card        เปิดจากริชเมนู — ดูบัตร
 *   /card?t=รหัส  สแกน QR สะสมแต้ม
 *   /card?r=รหัส  สแกน QR รับรางวัลจากจอพนักงาน
 */
export default function Page() {
  return (
    <Suspense fallback={<div className="screen center"><p className="hint">กำลังโหลด…</p></div>}>
      <CustomerCard />
    </Suspense>
  );
}

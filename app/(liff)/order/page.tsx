import { Suspense } from "react";
import DeliveryOrder from "@/components/DeliveryOrder";
import "./order.css";

export default function Page() {
  return (
    <Suspense fallback={<div className="ord"><div className="ord-center"><p>กำลังเปิดร้าน…</p></div></div>}>
      <DeliveryOrder />
    </Suspense>
  );
}

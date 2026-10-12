import { Suspense } from "react";
import DeliveryOrder from "@/components/DeliveryOrder";

export default function Page() {
  return (
    <Suspense fallback={<div className="screen"><div className="grow center"><p className="hint">กำลังเปิด…</p></div></div>}>
      <DeliveryOrder />
    </Suspense>
  );
}

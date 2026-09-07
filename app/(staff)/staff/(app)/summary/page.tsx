import Link from "next/link";
import { cookies, headers } from "next/headers";

interface Summary {
  qr_issued: number;
  qr_claimed: number;
  qr_unclaimed: number;
  rewards_given: { name: string; n: number }[];
}

/**
 * สรุปกะ
 *
 * §4: ตัวเลข "ออกแล้วไม่มีคนสแกน" คือสัญญาณที่มีค่าที่สุด
 * ถ้าสูงผิดปกติแปลว่าพนักงานกดออก QR แล้วไม่ได้ยื่นให้ลูกค้าจริง
 * หรือยื่นแล้วลูกค้าไม่สนใจ ทั้งสองกรณีต้องแก้ที่หน้าร้าน ไม่ใช่ที่ระบบ
 */
export default async function Page() {
  const h = await headers();
  const jar = await cookies();
  const base = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const res = await fetch(`${base}/api/staff/summary`, {
    headers: { cookie: jar.toString() },
    cache: "no-store",
  });
  const d = (await res.json()) as Summary & { ok: boolean };

  const rate = d.qr_issued > 0 ? Math.round((d.qr_claimed / d.qr_issued) * 100) : null;

  return (
    <div className="screen">
      <div className="topbar">
        <h1>สรุปกะวันนี้</h1>
        <Link href="/staff" className="btn ghost small" style={{ width: "auto", textDecoration: "none" }}>
          ปิด
        </Link>
      </div>

      <div className="card stack" style={{ gap: 0 }}>
        <div className="rows">
          <div className="row"><span>QR ที่ออก</span><b>{d.qr_issued}</b></div>
          <div className="row"><span>ลูกค้าสแกนแล้ว</span><b>{d.qr_claimed}</b></div>
          <div className={`row${d.qr_unclaimed > 0 ? " flag" : ""}`}>
            <span>ออกแล้วไม่มีคนสแกน</span><b>{d.qr_unclaimed}</b>
          </div>
        </div>
      </div>

      {rate !== null && (
        <p className="hint" style={{ marginTop: 14 }}>
          อัตราการสแกน {rate}%
          {rate < 30 && " — ต่ำกว่าที่ควร ลองดูว่าได้ยื่น QR ให้ลูกค้าทุกบิลหรือเปล่า"}
        </p>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <p className="hint" style={{ textAlign: "left", marginBottom: 10 }}>รางวัลที่จ่ายวันนี้</p>
        {d.rewards_given.length === 0 ? (
          <p className="hint" style={{ textAlign: "left" }}>ยังไม่มี</p>
        ) : (
          <div className="rows">
            {d.rewards_given.map((r) => (
              <div className="row" key={r.name}><span>{r.name}</span><b>{r.n}</b></div>
            ))}
          </div>
        )}
      </div>

      <div className="grow" />
      <Link href="/staff" className="btn" style={{ textDecoration: "none" }}>กลับหน้าหลัก</Link>
    </div>
  );
}

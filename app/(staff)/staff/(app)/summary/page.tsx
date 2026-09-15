import Link from "next/link";
import { sql } from "@/lib/db";
import { branchOf, requireStaff } from "@/lib/auth/staff";

interface Summary {
  qr_issued: number;
  qr_claimed: number;
  qr_unclaimed: number;
  rewards_given: { name: string; n: number }[];
}

/**
 * เรียก DB โดยตรงหนึ่งคำสั่ง แทนการ fetch API ของตัวเองจาก Server Component
 * เพราะ Worker อาจส่ง cookie/runtime context ไม่ครบระหว่าง self-fetch ได้
 */
export default async function Page() {
  const sess = await requireStaff();
  const branchId = await branchOf(sess);

  let data: Summary | null = null;
  try {
    const [row] = await sql<{ result: Summary }[]>`
      SELECT api_shift_summary(${branchId}) AS result`;
    data = row?.result ?? null;
  } catch (error) {
    console.error("Unable to load staff shift summary", error);
  }

  if (!data) {
    return (
      <div className="screen">
        <div className="topbar"><h1>สรุปกะวันนี้</h1></div>
        <div className="grow center" style={{ gap: 12 }}>
          <div className="card" style={{ width: "100%", textAlign: "center" }}>
            <p className="big" style={{ fontSize: 24 }}>ยังโหลดสรุปกะไม่ได้</p>
            <p className="hint" style={{ marginTop: 8 }}>ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง</p>
          </div>
        </div>
        <Link href="/staff" className="btn" style={{ textDecoration: "none" }}>กลับหน้าหลัก</Link>
      </div>
    );
  }

  const issued = Number(data.qr_issued) || 0;
  const claimed = Number(data.qr_claimed) || 0;
  const unclaimed = Math.max(0, Number(data.qr_unclaimed) || 0);
  const rate = issued > 0 ? Math.round((claimed / issued) * 100) : 0;
  const rewards = Array.isArray(data.rewards_given) ? data.rewards_given : [];

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <h1>สรุปกะวันนี้</h1>
          <div className="who">เฉพาะสาขาที่กำลังเข้ากะ</div>
        </div>
        <Link href="/staff" className="btn ghost small" style={{ width: "auto", textDecoration: "none" }}>ปิด</Link>
      </div>

      <section className="card" style={{ padding: 22, background: "linear-gradient(135deg, #EAF4FA, #FFFFFF)" }}>
        <p className="hint" style={{ textAlign: "left", fontWeight: 600 }}>อัตราการสแกน QR</p>
        <div style={{ display: "flex", alignItems: "end", gap: 8, marginTop: 2 }}>
          <strong style={{ fontSize: 52, lineHeight: 1, color: "var(--brand)", fontVariantNumeric: "tabular-nums" }}>{rate}%</strong>
          <span style={{ color: "var(--muted)", paddingBottom: 5 }}>สำเร็จ {claimed} จาก {issued} ใบ</span>
        </div>
        <div style={{ height: 10, overflow: "hidden", borderRadius: 99, background: "#CDE4F1", marginTop: 18 }}>
          <div style={{ height: "100%", width: `${rate}%`, minWidth: rate > 0 ? 10 : 0, borderRadius: 99, background: "var(--brand)" }} />
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginTop: 14 }}>
        <div className="card" style={{ padding: 18 }}>
          <span className="hint" style={{ display: "block", textAlign: "left" }}>QR ที่ออก</span>
          <strong style={{ display: "block", fontSize: 34, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{issued}</strong>
        </div>
        <div className="card" style={{ padding: 18, background: "var(--ok-bg)", borderColor: "#CDE3CB" }}>
          <span className="hint" style={{ display: "block", textAlign: "left", color: "var(--ok)" }}>สแกนสำเร็จ</span>
          <strong style={{ display: "block", fontSize: 34, marginTop: 4, color: "var(--ok)", fontVariantNumeric: "tabular-nums" }}>{claimed}</strong>
        </div>
      </section>

      <section className="card" style={{ marginTop: 14, borderColor: unclaimed > 0 ? "#E8C98D" : "var(--line)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600 }}>ออกแล้วไม่มีคนสแกน</p>
            <p className="hint" style={{ textAlign: "left", marginTop: 3 }}>ดูว่าได้ยื่น QR ให้ลูกค้าทุกบิลหรือไม่</p>
          </div>
          <strong style={{ fontSize: 34, color: unclaimed > 0 ? "var(--warn)" : "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{unclaimed}</strong>
        </div>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <p style={{ margin: "0 0 8px", fontWeight: 600 }}>🎁 รางวัลที่จ่ายวันนี้</p>
        {rewards.length === 0 ? (
          <p className="hint" style={{ textAlign: "left" }}>ยังไม่มีการจ่ายรางวัลในกะนี้</p>
        ) : (
          <div className="rows">
            {rewards.map((reward) => (
              <div className="row" key={reward.name}><span>{reward.name}</span><b>{reward.n}</b></div>
            ))}
          </div>
        )}
      </section>

      <div className="grow" />
      <Link href="/staff" className="btn" style={{ textDecoration: "none", marginTop: 18 }}>กลับหน้าหลัก</Link>
    </div>
  );
}

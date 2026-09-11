import Link from "next/link";
import { sql } from "@/lib/db";
import DailyQrSummary, { DailyStatItem } from "@/components/DailyQrSummary";

interface Stats {
  stamps_today: number;
  stamps_all: number;
  customers_all: number;
  rewards_today: number;
  rewards_all: number;
  rewards_pending: number;
  tokens_today: number;
  tokens_used: number;
  daily_stats: DailyStatItem[];
  recent_activity: {
    id: number;
    slot_no: number;
    source: string;
    customer_name: string;
    branch_name: string;
    created_at: string;
  }[];
}

export default async function AdminDashboard() {
  const [row] = await sql<{ result: Stats }[]>`
    SELECT api_admin_stats() AS result`;
  const d = row.result;

  const qrRate = d.tokens_today > 0 ? Math.round((d.tokens_used / d.tokens_today) * 100) : 0;

  function timeAgo(iso: string) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return "เมื่อครู่";
    if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ชม. ที่แล้ว`;
    return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {/* ทางลัดออก QR หน้าร้านสำหรับเจ้าของร้าน */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Link
          href="/staff/stamp"
          className="btn"
          style={{
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "12px 14px",
            fontSize: 15,
          }}
        >
          <span>⚡</span> ออก QR สะสมแต้ม
        </Link>
        <Link
          href="/staff/reward"
          className="btn ghost"
          style={{
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "12px 14px",
            fontSize: 15,
          }}
        >
          <span>🎁</span> ออก QR รับรางวัล
        </Link>
      </div>

      {/* สถิติประจำวัน */}
      <div>
        <h2 style={{ fontSize: 16, margin: "0 0 10px", color: "var(--muted)" }}>วันนี้ (Today)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          <div className="card" style={{ padding: "16px 18px" }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>สแตมป์ที่แจกวันนี้</span>
            <div style={{ fontSize: 32, fontWeight: 700, color: "var(--brand)", marginTop: 4 }}>
              {d.stamps_today}
            </div>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>จากทั้งหมด {d.stamps_all} ดวง</span>
          </div>

          <div className="card" style={{ padding: "16px 18px" }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>รางวัลที่แจกวันนี้</span>
            <div style={{ fontSize: 32, fontWeight: 700, color: "var(--ok)", marginTop: 4 }}>
              {d.rewards_today}
            </div>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>สิทธิ์รอรับ {d.rewards_pending} สิทธิ์</span>
          </div>
        </div>
      </div>

      {/* สรุป QR หน้าร้านวันนี้ */}
      <div className="card">
        <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>ประสิทธิภาพการออก QR วันนี้</h3>
        <div className="rows">
          <div className="row">
            <span>QR ที่พนักงานออก</span>
            <b>{d.tokens_today}</b>
          </div>
          <div className="row">
            <span>ลูกค้าสแกนสำเร็จ</span>
            <b>{d.tokens_used}</b>
          </div>
          <div className={`row${d.tokens_today - d.tokens_used > 0 ? " flag" : ""}`}>
            <span>ออกแล้วไม่มีคนสแกน</span>
            <b>{d.tokens_today - d.tokens_used}</b>
          </div>
          <div className="row">
            <span>อัตราการสแกนสำเร็จ</span>
            <b>{qrRate}%</b>
          </div>
        </div>
      </div>

      {/* สรุปรายวัน + Export Excel */}
      <DailyQrSummary dailyStats={d.daily_stats || []} />

      {/* สถิติสะสม */}
      <div className="card">
        <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>สถิติสะสมทั้งระบบ</h3>
        <div className="rows">
          <div className="row">
            <span>ลูกค้าลงทะเบียนทั้งหมด</span>
            <b>{d.customers_all} คน</b>
          </div>
          <div className="row">
            <span>สแตมป์ทั้งหมดที่เคยปั๊ม</span>
            <b>{d.stamps_all} ดวง</b>
          </div>
          <div className="row">
            <span>รางวัลที่มอบให้ลูกค้าแล้ว</span>
            <b>{d.rewards_all} ชิ้น</b>
          </div>
        </div>
      </div>

      {/* รายการเคลื่อนไหวล่าสุด */}
      <div className="card">
        <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>ความเคลื่อนไหวล่าสุด (สแตมป์)</h3>
        {d.recent_activity.length === 0 ? (
          <p className="hint" style={{ textAlign: "left" }}>ยังไม่มีรายการ</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {d.recent_activity.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--line)",
                  fontSize: 14,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                    {a.customer_name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {a.branch_name} · ช่องที่ {a.slot_no} ({a.source === "qr" ? "หน้าร้าน" : a.source})
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {timeAgo(a.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

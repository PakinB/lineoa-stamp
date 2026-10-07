"use client";

import { useEffect, useState } from "react";
import {
  downloadQrReport,
  preloadExcelJs,
  type DailyStatItem,
  type DailyLineScanItem,
  type BranchStatItem,
  type BranchDailyItem,
  type ReportOverview,
} from "@/lib/qr-report";

// หน้าแอดมินยังนำเข้าชนิดจากไฟล์นี้อยู่ — ส่งต่อให้เพื่อไม่ต้องแก้ทุกที่ที่เรียกใช้
export type { DailyStatItem, DailyLineScanItem, BranchStatItem, BranchDailyItem, ReportOverview };

export default function DailyQrSummary({
  dailyStats,
  dailyLineScans,
  branchStats,
  branchDaily,
  overview,
  windowDays,
}: {
  dailyStats: DailyStatItem[];
  dailyLineScans: DailyLineScanItem[];
  branchStats: BranchStatItem[];
  branchDaily: BranchDailyItem[];
  overview?: ReportOverview;
  windowDays: number;
}) {
  const [downloading, setDownloading] = useState(false);

  // โหลดไลบรารีไว้เงียบ ๆ ตอนหน้าว่าง ตอนเจ้าของกดปุ่มจริงจะได้ไฟล์ทันที
  // ไม่ต้องยืนรอโหลดเกือบหนึ่งเมกะไบต์
  useEffect(() => {
    if (dailyStats.length === 0) return;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1500));
    const id = idle(() => preloadExcelJs());
    return () => window.cancelIdleCallback?.(id as number);
  }, [dailyStats.length]);

  async function handleExportExcel() {
    try {
      setDownloading(true);
      await downloadQrReport({
        dailyStats, dailyLineScans, branchStats, branchDaily, overview, windowDays,
      });
    } catch (err) {
      console.error("Export Excel error:", err);
      alert("ดาวน์โหลดไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div>
          <h3 style={{ fontSize: 16, margin: 0 }}>📑 สรุปการออก QR รายวัน (Daily Report)</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            ไฟล์ Excel — ภาพรวม · สรุปรายวัน{branchStats.length > 1 ? " · รายสาขา" : ""} · สแกนรายบัญชี LINE
          </span>
        </div>

        <button
          type="button"
          onClick={handleExportExcel}
          disabled={downloading || dailyStats.length === 0}
          className="btn small"
          style={{
            width: "auto",
            padding: "8px 16px",
            background: "#107C41", // สีเขียว Excel
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {downloading ? "กำลังสร้างไฟล์…" : "📥 ดาวน์โหลด Excel (.xlsx)"}
        </button>
      </div>

      {dailyStats.length === 0 ? (
        <p className="hint" style={{ textAlign: "left" }}>ยังไม่มีข้อมูลการออก QR ในระบบ</p>
      ) : (
        <div style={{ overflowX: "auto", margin: "0 -4px" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
              textAlign: "left",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--line)", color: "var(--muted)" }}>
                <th style={{ padding: "8px 10px", fontWeight: 600 }}>วันที่</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>พนักงานออก</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>สแกนสำเร็จ</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>ไม่ได้สแกน</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>ดวงที่แจก</th>
                <th style={{ padding: "8px 10px", fontWeight: 600, textAlign: "right" }}>ความสำเร็จ</th>
              </tr>
            </thead>
            <tbody>
              {dailyStats.map((d) => (
                <tr
                  key={d.date}
                  style={{
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <td style={{ padding: "10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {d.date_th}
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>{d.date}</div>
                  </td>
                  <td style={{ padding: "10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    <b>{d.issued}</b>
                  </td>
                  <td style={{ padding: "10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ok)" }}>
                    <b>{d.claimed}</b>
                  </td>
                  <td
                    style={{
                      padding: "10px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: d.unclaimed > 0 ? "var(--warn)" : "var(--muted)",
                    }}
                  >
                    <b>{d.unclaimed}</b>
                  </td>
                  <td style={{ padding: "10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    <b>{d.stamps}</b>
                    {d.promo_issued > 0 && (
                      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>
                        โปรฯ {d.promo_issued} ใบ
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: d.rate >= 70 ? "var(--ok-bg)" : d.rate >= 40 ? "#FFF3D6" : "#FDECEA",
                        color: d.rate >= 70 ? "var(--ok)" : d.rate >= 40 ? "var(--warn)" : "var(--stamp)",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {d.rate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

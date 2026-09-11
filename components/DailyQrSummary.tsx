"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

export interface DailyStatItem {
  date: string;
  date_th: string;
  issued: number;
  claimed: number;
  unclaimed: number;
  rate: number;
}

export default function DailyQrSummary({ dailyStats }: { dailyStats: DailyStatItem[] }) {
  const [downloading, setDownloading] = useState(false);

  function handleExportExcel() {
    try {
      setDownloading(true);

      const rows = [
        ["วันที่", "QR ที่พนักงานออก (ใบ)", "ลูกค้าสแกนสำเร็จ (ใบ)", "ออกแล้วไม่มีคนสแกน (ใบ)", "อัตราการสแกนสำเร็จ (%)"],
        ...dailyStats.map((d) => [
          d.date,
          d.issued,
          d.claimed,
          d.unclaimed,
          `${d.rate}%`,
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // กำหนดความกว้างคอลัมน์ให้อ่านง่าย
      ws["!cols"] = [
        { wch: 14 }, // วันที่
        { wch: 22 }, // QR ที่พนักงานออก
        { wch: 22 }, // ลูกค้าสแกนสำเร็จ
        { wch: 22 }, // ออกแล้วไม่มีคนสแกน
        { wch: 24 }, // อัตราการสแกนสำเร็จ
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "สรุปการออก QR รายวัน");

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `สรุปการออกQR_รายวัน_${today}.xlsx`);
    } catch (err) {
      console.error("Export Excel error:", err);
      alert("ดาวน์โหลดไฟล์ Excel ไม่สำเร็จ");
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
            สถิติ QR ที่ออก, สแกนสำเร็จ, ไม่ได้สแกน และอัตราความสำเร็จ
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

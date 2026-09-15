"use client";

import { useState } from "react";

interface XlsxModule {
  utils: {
    aoa_to_sheet: (rows: unknown[][]) => { [key: string]: unknown };
    book_new: () => unknown;
    book_append_sheet: (book: unknown, sheet: unknown, name: string) => void;
  };
  writeFile: (book: unknown, filename: string) => void;
}

declare global {
  // SheetJS ถูกโหลดเฉพาะใน browser ตอนกด export เพื่อไม่ให้เข้า Worker bundle
  var XLSX: XlsxModule | undefined;
}

const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

function loadXlsx(): Promise<XlsxModule> {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${XLSX_CDN}"]`);
    if (existing) {
      existing.addEventListener("load", () => globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error("XLSX ไม่พร้อมใช้งาน")), { once: true });
      existing.addEventListener("error", () => reject(new Error("โหลด XLSX ไม่สำเร็จ")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = XLSX_CDN;
    script.async = true;
    script.onload = () => globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error("XLSX ไม่พร้อมใช้งาน"));
    script.onerror = () => reject(new Error("โหลด XLSX ไม่สำเร็จ"));
    document.head.appendChild(script);
  });
}

export interface DailyStatItem {
  date: string;
  date_th: string;
  issued: number;
  claimed: number;
  unclaimed: number;
  rate: number;
}

export interface DailyLineScanItem {
  date: string;
  date_th: string;
  line_name: string;
  qr_scans: number;
}

export default function DailyQrSummary({
  dailyStats,
  dailyLineScans,
}: {
  dailyStats: DailyStatItem[];
  dailyLineScans: DailyLineScanItem[];
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleExportExcel() {
    try {
      setDownloading(true);
      // โหลดเฉพาะ browser ตอนกด export: ไม่ให้โค้ด Excel เข้า Worker /card
      const XLSX = await loadXlsx();

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

      // แยกชีตเพื่อให้หนึ่งบัญชี LINE มีได้หลายแถวตามวัน โดยไม่ทำให้สรุปรายวันอ่านยาก
      const lineRows = [
        ["วันที่", "ชื่อ LINE", "จำนวน QR ที่สแกนสำเร็จ (ใบ)"],
        ...dailyLineScans.map((scan) => [scan.date, scan.line_name, scan.qr_scans]),
      ];
      const lineWs = XLSX.utils.aoa_to_sheet(lineRows);
      lineWs["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, lineWs, "สแกนรายบัญชี LINE");

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
            สถิติ QR ที่ออก, สแกนสำเร็จ, ไม่ได้สแกน และรายชื่อ LINE ในไฟล์ Excel
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

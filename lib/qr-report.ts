/**
 * สร้างไฟล์ Excel รายงาน QR สำหรับเจ้าของร้าน
 *
 * ใช้ ExcelJS แทน SheetJS เพราะรุ่นฟรีของ SheetJS **เขียนสไตล์ลงเซลล์ไม่ได้เลย**
 * (ตัวหนา สีพื้น เส้นขอบ เป็นของรุ่น Pro) ไฟล์ที่ได้จึงเป็นตารางเปล่า ๆ
 * รายงานที่เจ้าของเปิดดูหรือปรินต์ให้คนอื่นดูต้องอ่านออกตั้งแต่แถวแรก
 *
 * **เสิร์ฟไฟล์ไลบรารีจากเครื่องเราเอง** ไม่ใช่ CDN ภายนอก เพราะ
 * Cloudflare ส่งจาก edge ที่ใกล้กว่าและบีบ gzip เหลือ ~250 KB
 * และรายงานยังออกได้แม้เน็ตที่ร้านบล็อก CDN ภายนอก
 * อัปเดตเวอร์ชัน: `npm pack exceljs@X.Y.Z` แล้วเอา `dist/exceljs.min.js`
 * มาวางที่ `public/vendor/` พร้อมแก้ชื่อไฟล์ในตัวแปรข้างล่าง
 */

const EXCELJS_URL = "/vendor/exceljs-4.4.0.min.js";

/* ── สีแบรนด์ (ARGB ตาม app/globals.css) ─────────────────────────────── */
const BRAND = "FF2B86BC";       // น้ำเงินหลัก — หัวตาราง
const BRAND_DARK = "FF1F5F86";  // น้ำเงินเข้ม — หัวรายงาน
const GROUND = "FFFDF7F0";      // ครีมอ่อน — แถบสลับ
const TOTAL_BG = "FFEFF4F8";    // ฟ้าจาง — แถวรวม
const LINE = "FFD9D9D9";        // เส้นตาราง
const OK = "FF1B7F4B";
const WARN = "FFB26B00";
const BAD = "FFC62828";
const PROMO = "FF9A3412";       // ส้มเข้ม — ตัวเลขของ QR โปรโมชั่น
const INK = "FF1F2933";
const MUTED = "FF6B7280";

// Tahoma มีทั้ง Windows และ Mac และวางสระไทยถูก — ฟอนต์ default ของ Excel ไม่แน่นอน
const FONT = "Tahoma";

/** เกณฑ์เดียวกับที่หน้าแอดมินใช้ระบายสี — เปลี่ยนที่นี่ที่เดียว */
function grade(rate: number): { label: string; color: string } {
  if (rate >= 70) return { label: "ดี", color: OK };
  if (rate >= 40) return { label: "พอใช้", color: WARN };
  return { label: "ต้องปรับปรุง", color: BAD };
}

/* ── ชนิดข้อมูลที่รับเข้ามา (ตรงกับ api_admin_stats ใน 0008) ─────────── */

export interface DailyStatItem {
  date: string;          // YYYY-MM-DD
  date_th: string;       // DD/MM/YYYY
  issued: number;        // QR ที่ออก (ใบ)
  claimed: number;       // ถูกสแกน (ใบ)
  unclaimed: number;
  rate: number;          // 0–100
  stamps: number;        // ดวงที่แจกจริง — QR โปรโมชั่นใบเดียวให้หลายดวง
  promo_issued: number;
  promo_claimed: number;
}

export interface DailyLineScanItem {
  date: string;
  date_th: string;
  line_name: string;
  qr_scans: number;      // ใบ
  stamps: number;        // ดวง
}

export interface BranchStatItem {
  branch_name: string;
  issued: number;
  claimed: number;
  unclaimed: number;
  stamps: number;
  rate: number;
}

export interface BranchDailyItem {
  date: string;
  branch_name: string;
  issued: number;
  claimed: number;
  stamps: number;
  rate: number;
}

/** ตัวเลขสะสมจากหน้าแอดมิน ใส่ในชีตภาพรวมเพื่อให้รายงานยืนได้ด้วยตัวเอง */
export interface ReportOverview {
  customers_all: number;
  stamps_all: number;
  rewards_all: number;
  rewards_pending: number;
}

export interface ReportData {
  dailyStats: DailyStatItem[];
  dailyLineScans: DailyLineScanItem[];
  branchStats: BranchStatItem[];
  branchDaily: BranchDailyItem[];
  overview?: ReportOverview;
  /** ช่วงย้อนหลังของข้อมูลที่แตกเป็นรายคน/รายสาขาต่อวัน (สรุปรายวันยังครบทุกวัน) */
  windowDays: number;
}

/* ── ชนิดของ ExcelJS เท่าที่ใช้จริง (ไม่ได้ลง @types เพราะโหลดเป็นสคริปต์) ── */

interface XFont { name?: string; size?: number; bold?: boolean; italic?: boolean; color?: { argb: string } }
interface XFill { type: "pattern"; pattern: "solid"; fgColor: { argb: string } }
interface XBorderSide { style: string; color?: { argb: string } }
interface XBorder { top?: XBorderSide; left?: XBorderSide; bottom?: XBorderSide; right?: XBorderSide }
interface XAlign { horizontal?: string; vertical?: string; wrapText?: boolean }

interface XCell {
  value: unknown;
  font?: XFont;
  fill?: XFill;
  border?: XBorder;
  alignment?: XAlign;
  numFmt?: string;
}

interface XRow {
  height?: number;
  getCell(index: number): XCell;
}

interface XWorksheet {
  columns: { width: number }[];
  views: { state?: string; ySplit?: number; showGridLines?: boolean }[];
  pageSetup: Record<string, unknown>;
  autoFilter?: string;
  addRow(values: unknown[]): XRow;
  getRow(index: number): XRow;
  mergeCells(range: string): void;
}

interface XWorkbook {
  creator: string;
  created: Date;
  addWorksheet(name: string, options?: Record<string, unknown>): XWorksheet;
  xlsx: { writeBuffer(): Promise<ArrayBuffer> };
}

export interface ExcelJsModule { Workbook: new () => XWorkbook }

declare global {
  var ExcelJS: ExcelJsModule | undefined;
}

let loading: Promise<ExcelJsModule> | null = null;

/**
 * โหลดไลบรารี — เรียกซ้ำได้ ครั้งที่สองได้ของเดิมทันที
 *
 * เรียกล่วงหน้าตอนหน้าแอดมินเปิดได้เลย (preload) ตอนเจ้าของกดปุ่มจริง
 * จะไม่ต้องรออะไร ไฟล์ใหญ่ราวหนึ่งเมกะไบต์ก่อนบีบ
 */
export function loadExcelJs(): Promise<ExcelJsModule> {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (loading) return loading;

  loading = new Promise<ExcelJsModule>((resolve, reject) => {
    const done = () => globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error("ExcelJS ไม่พร้อมใช้งาน"));
    const fail = () => { loading = null; reject(new Error("โหลดตัวสร้างไฟล์ Excel ไม่สำเร็จ")); };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${EXCELJS_URL}"]`);
    if (existing) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = EXCELJS_URL;
    script.async = true;
    script.onload = done;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

/** โหลดไว้เงียบ ๆ ตอนว่าง — ล้มเหลวก็ไม่ต้องทำอะไร เดี๋ยวตอนกดปุ่มลองใหม่เอง */
export function preloadExcelJs(): void {
  loadExcelJs().catch(() => {});
}

/* ── ตัวช่วยเรื่องวันที่ ─────────────────────────────────────────────── */

const MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const DAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

/**
 * แปลง YYYY-MM-DD เป็น Date ที่ "เที่ยงวัน UTC"
 *
 * ExcelJS คิดเลขวันที่จากเวลา UTC ล้วน ถ้าสร้างเป็นเที่ยงคืนตามเวลาเครื่อง
 * (UTC+7) ค่าที่เขียนลงไฟล์จะร่นไปเป็นวันก่อนหน้า เที่ยงวันจึงปลอดภัยทั้งสองทาง
 */
function toExcelDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function thaiDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_TH[m - 1]} ${y}`;
}

function thaiWeekday(iso: string): string {
  return DAY_TH[toExcelDate(iso).getUTCDay()];
}

function stampNow(): string {
  const now = new Date();
  const time = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${thaiDate(iso)} เวลา ${time} น.`;
}

/* ── ตัวช่วยจัดรูปแบบเซลล์ ───────────────────────────────────────────── */

const thinBorder: XBorder = {
  top: { style: "thin", color: { argb: LINE } },
  left: { style: "thin", color: { argb: LINE } },
  bottom: { style: "thin", color: { argb: LINE } },
  right: { style: "thin", color: { argb: LINE } },
};

function fillOf(argb: string): XFill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** หัวรายงานบนสุด เหมือนกันทุกชีตเพื่อให้ปรินต์แยกหน้าแล้วยังรู้ที่มา */
function writeTitleBlock(ws: XWorksheet, title: string, subtitle: string, note: string | null, lastCol: string) {
  const rows: [string, XFont, number][] = [
    ["ร้านหมาล่า La-Mi", { name: FONT, size: 16, bold: true, color: { argb: BRAND_DARK } }, 24],
    [title, { name: FONT, size: 12, bold: true, color: { argb: INK } }, 18],
    [subtitle, { name: FONT, size: 10, color: { argb: MUTED } }, 15],
    [`ออกรายงานเมื่อ ${stampNow()}`, { name: FONT, size: 10, color: { argb: MUTED } }, 15],
  ];
  if (note) rows.push([note, { name: FONT, size: 10, italic: true, color: { argb: WARN } }, 15]);

  rows.forEach(([text, font, height], i) => {
    const r = ws.getRow(i + 1);
    r.height = height;
    r.getCell(1).value = text;
    r.getCell(1).font = font;
    r.getCell(1).alignment = { vertical: "middle" };
    ws.mergeCells(`A${i + 1}:${lastCol}${i + 1}`);
  });

  const gap = rows.length + 1;
  ws.getRow(gap).height = 6;  // ช่องว่างคั่นก่อนตาราง
  return gap + 1;             // แถวของหัวตาราง
}

/** แถวหัวตาราง — พื้นน้ำเงิน ตัวหนาสีขาว ตรึงไว้ตอนเลื่อนและตอนปรินต์ */
function writeHeaderRow(ws: XWorksheet, rowNo: number, labels: string[]) {
  const row = ws.getRow(rowNo);
  row.height = 30;
  labels.forEach((label, i) => {
    const cell = row.getCell(i + 1);
    cell.value = label;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = fillOf(BRAND);
    cell.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
  });
}

interface CellSpec { value: unknown; numFmt?: string; align: string; font?: XFont }

function writeDataRow(ws: XWorksheet, rowNo: number, zebra: boolean, cells: CellSpec[]) {
  const row = ws.getRow(rowNo);
  row.height = 20;
  cells.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c.value;
    if (c.numFmt) cell.numFmt = c.numFmt;
    cell.font = c.font ?? { name: FONT, size: 10, color: { argb: INK } };
    cell.alignment = { horizontal: c.align, vertical: "middle" };
    cell.border = thinBorder;
    if (zebra) cell.fill = fillOf(GROUND);
  });
}

function writeTotalRow(ws: XWorksheet, rowNo: number, cells: CellSpec[]) {
  const row = ws.getRow(rowNo);
  row.height = 24;
  cells.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c.value;
    if (c.numFmt) cell.numFmt = c.numFmt;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: c.font?.color?.argb ?? INK } };
    cell.alignment = { horizontal: c.align, vertical: "middle" };
    cell.fill = fillOf(TOTAL_BG);
    cell.border = { ...thinBorder, top: { style: "medium", color: { argb: BRAND } } };
  });
}

const A4_PORTRAIT = {
  paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
  margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.5, header: 0.3, footer: 0.3 },
};

/* ── ชีตที่ 1: ภาพรวม ────────────────────────────────────────────────── */

function buildOverviewSheet(wb: XWorkbook, data: ReportData, rangeLabel: string) {
  const { dailyStats: stats, dailyLineScans: lineScans, branchStats, overview, windowDays } = data;

  const ws = wb.addWorksheet("ภาพรวม", { properties: { defaultRowHeight: 18 } });
  ws.columns = [{ width: 34 }, { width: 22 }, { width: 4 }, { width: 30 }, { width: 14 }];
  ws.views = [{ showGridLines: false }];

  let r = writeTitleBlock(ws, "รายงานสรุปการใช้งาน QR สะสมแต้ม", rangeLabel, null, "E");

  const issued = stats.reduce((s, d) => s + d.issued, 0);
  const claimed = stats.reduce((s, d) => s + d.claimed, 0);
  const stamps = stats.reduce((s, d) => s + d.stamps, 0);
  const promoIssued = stats.reduce((s, d) => s + d.promo_issued, 0);
  const promoClaimed = stats.reduce((s, d) => s + d.promo_claimed, 0);
  const unclaimed = issued - claimed;
  const rate = issued > 0 ? claimed / issued : 0;

  const busiest = stats.reduce<DailyStatItem | null>((best, d) => (!best || d.issued > best.issued ? d : best), null);
  const worst = stats
    .filter((d) => d.issued >= 3) // วันที่ออกไม่กี่ใบ เปอร์เซ็นต์แกว่งจนไม่มีความหมาย
    .reduce<DailyStatItem | null>((low, d) => (!low || d.rate < low.rate ? d : low), null);

  const perName = new Map<string, number>();
  for (const s of lineScans) perName.set(s.line_name, (perName.get(s.line_name) ?? 0) + s.stamps);
  const top = [...perName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  /** หัวข้อคั่นกลุ่ม */
  function section(text: string) {
    const row = ws.getRow(r);
    row.height = 24;
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: BRAND_DARK } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND } } };
    row.getCell(2).border = { bottom: { style: "medium", color: { argb: BRAND } } };
    r += 1;
  }

  /** บรรทัด "ชื่อรายการ ....... ค่า" */
  function line(label: string, value: string | number, opts?: { numFmt?: string; color?: string; bold?: boolean }) {
    const row = ws.getRow(r);
    row.height = 20;
    const l = row.getCell(1);
    l.value = label;
    l.font = { name: FONT, size: 10, color: { argb: INK } };
    l.alignment = { vertical: "middle" };
    l.border = { bottom: { style: "hair", color: { argb: LINE } } };

    const v = row.getCell(2);
    v.value = value;
    v.font = { name: FONT, size: 11, bold: opts?.bold ?? true, color: { argb: opts?.color ?? INK } };
    v.alignment = { horizontal: "right", vertical: "middle" };
    v.border = { bottom: { style: "hair", color: { argb: LINE } } };
    if (opts?.numFmt) v.numFmt = opts.numFmt;
    r += 1;
  }

  section("QR หน้าร้าน");
  line("QR ที่พนักงานออกทั้งหมด", issued, { numFmt: "#,##0 \"ใบ\"" });
  line("ลูกค้าสแกนสำเร็จ", claimed, { numFmt: "#,##0 \"ใบ\"", color: OK });
  line("ออกแล้วไม่มีคนสแกน", unclaimed, { numFmt: "#,##0 \"ใบ\"", color: unclaimed > 0 ? WARN : MUTED });
  line("อัตราการสแกนสำเร็จเฉลี่ย", rate, { numFmt: "0.0%", color: grade(rate * 100).color });
  line("จำนวนวันที่มีการออก QR", stats.length, { numFmt: "#,##0 \"วัน\"" });
  if (busiest) line("วันที่ออก QR มากที่สุด", `${thaiDate(busiest.date)} (${busiest.issued} ใบ)`, { bold: false });
  if (worst) line("วันที่อัตราสแกนต่ำที่สุด", `${thaiDate(worst.date)} (${worst.rate}%)`, { bold: false, color: grade(worst.rate).color });
  r += 1;

  // ใบกับดวงไม่ใช่หน่วยเดียวกัน — QR โปรโมชั่นใบเดียวให้หลายดวง จึงต้องแยกให้ชัด
  section("ดวงที่แจกจริง");
  line("ดวงที่ลูกค้าได้รับทั้งหมด", stamps, { numFmt: "#,##0 \"ดวง\"", color: OK });
  line("QR โปรโมชั่นที่ออก", promoIssued, { numFmt: "#,##0 \"ใบ\"", color: PROMO });
  line("QR โปรโมชั่นที่ถูกสแกน", promoClaimed, { numFmt: "#,##0 \"ใบ\"", color: PROMO });
  line("ดวงส่วนเกินจากโปรโมชั่น", stamps - claimed, { numFmt: "#,##0 \"ดวง\"", color: PROMO });
  r += 1;

  if (branchStats.length > 0) {
    section("แยกตามสาขา");
    for (const b of branchStats) {
      line(`${b.branch_name} — ออก ${b.issued} ใบ · ได้ ${b.stamps} ดวง`, b.rate / 100, {
        numFmt: "0.0%", color: grade(b.rate).color,
      });
    }
    r += 1;
  }

  if (overview) {
    section("ยอดสะสมทั้งระบบ");
    line("ลูกค้าที่ลงทะเบียนแล้ว", overview.customers_all, { numFmt: "#,##0 \"คน\"" });
    line("สแตมป์ที่ปั๊มไปแล้วทั้งหมด", overview.stamps_all, { numFmt: "#,##0 \"ดวง\"" });
    line("รางวัลที่มอบให้ลูกค้าแล้ว", overview.rewards_all, { numFmt: "#,##0 \"ชิ้น\"" });
    line("สิทธิ์ที่ลูกค้ายังไม่มารับ", overview.rewards_pending, { numFmt: "#,##0 \"สิทธิ์\"", color: WARN });
    r += 1;
  }

  if (top.length > 0) {
    section(`ลูกค้าที่ได้ดวงมากที่สุด 5 อันดับ (${windowDays} วันล่าสุด)`);
    top.forEach(([name, count], i) => line(`${i + 1}. ${name}`, count, { numFmt: "#,##0 \"ดวง\"", bold: false }));
    r += 1;
  }

  // หมายเหตุจาก docs/design.md §12 — ตัวเลขนี้อ่านผิดทางได้ง่าย จึงเขียนกำกับไว้ในไฟล์เลย
  const note = ws.getRow(r);
  note.height = 44;
  const noteCell = note.getCell(1);
  noteCell.value =
    "หมายเหตุ · อัตราการสแกนสำเร็จที่ต่ำ มักแปลว่าพนักงานไม่ได้ยื่น QR ให้ลูกค้าตอนเก็บเงิน " +
    "ไม่ใช่ความผิดพลาดของระบบ — ถ้าต่ำกว่า 30% ติดกันหลายวัน ให้ไปดูที่หน้าร้านก่อน\n" +
    `ชีตสรุปรายวันและสรุปรายสาขาคืนครบทุกวันตั้งแต่เปิดระบบ · ชีตที่แตกเป็นรายคนและรายสาขาต่อวัน แสดง ${windowDays} วันล่าสุด (ข้อมูลเก่ายังอยู่ครบในระบบ ปรับช่วงได้ที่หน้าตั้งค่า)`;
  noteCell.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
  noteCell.alignment = { vertical: "middle", wrapText: true };
  noteCell.fill = fillOf(GROUND);
  ws.mergeCells(`A${r}:E${r}`);

  ws.pageSetup = { ...A4_PORTRAIT };
}

/* ── ชีตที่ 2: สรุปรายวัน ────────────────────────────────────────────── */

function buildDailySheet(wb: XWorkbook, stats: DailyStatItem[], rangeLabel: string) {
  const ws = wb.addWorksheet("สรุปรายวัน", { properties: { defaultRowHeight: 18 } });
  ws.columns = [
    { width: 13 }, { width: 11 }, { width: 13 }, { width: 13 },
    { width: 13 }, { width: 13 }, { width: 14 }, { width: 15 }, { width: 14 },
  ];
  ws.views = [{ showGridLines: false }];

  const HEAD = writeTitleBlock(ws, "สรุปการออก QR รายวัน", rangeLabel, null, "I");
  writeHeaderRow(ws, HEAD, [
    "วันที่", "วัน", "QR ที่ออก\n(ใบ)", "สแกนสำเร็จ\n(ใบ)", "ไม่ได้สแกน\n(ใบ)",
    "ดวงที่แจก\n(ดวง)", "QR โปรโมชั่น\n(ใบ)", "อัตราสแกนสำเร็จ", "ผลประเมิน",
  ]);

  stats.forEach((d, i) => {
    const g = grade(d.rate);
    writeDataRow(ws, HEAD + 1 + i, i % 2 === 1, [
      { value: toExcelDate(d.date), numFmt: "dd/mm/yyyy", align: "left" },
      { value: thaiWeekday(d.date), align: "left" },
      { value: d.issued, numFmt: "#,##0", align: "right" },
      { value: d.claimed, numFmt: "#,##0", align: "right", font: { name: FONT, size: 10, color: { argb: OK } } },
      {
        value: d.unclaimed, numFmt: "#,##0", align: "right",
        font: { name: FONT, size: 10, color: { argb: d.unclaimed > 0 ? WARN : MUTED } },
      },
      { value: d.stamps, numFmt: "#,##0", align: "right", font: { name: FONT, size: 10, bold: true, color: { argb: INK } } },
      {
        value: d.promo_issued, numFmt: "#,##0", align: "right",
        font: { name: FONT, size: 10, color: { argb: d.promo_issued > 0 ? PROMO : MUTED } },
      },
      // เก็บเป็นตัวเลขจริง 0–1 แล้วใส่รูปแบบ % เพื่อให้เอาไปทำกราฟหรือหาค่าเฉลี่ยต่อได้
      { value: d.rate / 100, numFmt: "0.0%", align: "right", font: { name: FONT, size: 10, bold: true, color: { argb: g.color } } },
      { value: g.label, align: "center", font: { name: FONT, size: 10, bold: true, color: { argb: g.color } } },
    ]);
  });

  // แถวรวม — อัตรารวมต้องคิดจากยอดจริง ไม่ใช่เฉลี่ยของเปอร์เซ็นต์รายวัน
  const issued = stats.reduce((s, d) => s + d.issued, 0);
  const claimed = stats.reduce((s, d) => s + d.claimed, 0);
  const totalRate = issued > 0 ? claimed / issued : 0;
  const g = grade(totalRate * 100);

  writeTotalRow(ws, HEAD + 1 + stats.length, [
    { value: "รวมทั้งหมด", align: "left" },
    { value: `${stats.length} วัน`, align: "left" },
    { value: issued, numFmt: "#,##0", align: "right" },
    { value: claimed, numFmt: "#,##0", align: "right" },
    { value: issued - claimed, numFmt: "#,##0", align: "right" },
    { value: stats.reduce((s, d) => s + d.stamps, 0), numFmt: "#,##0", align: "right" },
    { value: stats.reduce((s, d) => s + d.promo_issued, 0), numFmt: "#,##0", align: "right", font: { color: { argb: PROMO } } },
    { value: totalRate, numFmt: "0.0%", align: "right", font: { color: { argb: g.color } } },
    { value: g.label, align: "center", font: { color: { argb: g.color } } },
  ]);

  ws.views = [{ state: "frozen", ySplit: HEAD, showGridLines: false }];
  if (stats.length > 0) ws.autoFilter = `A${HEAD}:I${HEAD + stats.length}`;
  ws.pageSetup = { ...A4_PORTRAIT, printTitlesRow: `${HEAD}:${HEAD}` };
}

/* ── ชีตที่ 3: รายสาขาต่อวัน (เฉพาะเมื่อมีมากกว่าหนึ่งสาขา) ──────────── */

function buildBranchSheet(wb: XWorkbook, rows: BranchDailyItem[], rangeLabel: string, windowDays: number) {
  const ws = wb.addWorksheet("รายสาขา รายวัน", { properties: { defaultRowHeight: 18 } });
  ws.columns = [{ width: 13 }, { width: 11 }, { width: 24 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 15 }];
  ws.views = [{ showGridLines: false }];

  const HEAD = writeTitleBlock(
    ws, "สรุปการออก QR แยกตามสาขา", rangeLabel,
    `แสดง ${windowDays} วันล่าสุด — ข้อมูลเก่ากว่านั้นยังอยู่ครบในระบบ`, "G",
  );
  writeHeaderRow(ws, HEAD, [
    "วันที่", "วัน", "สาขา", "QR ที่ออก\n(ใบ)", "สแกนสำเร็จ\n(ใบ)", "ดวงที่แจก\n(ดวง)", "อัตราสแกนสำเร็จ",
  ]);

  rows.forEach((b, i) => {
    const g = grade(b.rate);
    writeDataRow(ws, HEAD + 1 + i, i % 2 === 1, [
      { value: toExcelDate(b.date), numFmt: "dd/mm/yyyy", align: "left" },
      { value: thaiWeekday(b.date), align: "left" },
      { value: b.branch_name, align: "left" },
      { value: b.issued, numFmt: "#,##0", align: "right" },
      { value: b.claimed, numFmt: "#,##0", align: "right", font: { name: FONT, size: 10, color: { argb: OK } } },
      { value: b.stamps, numFmt: "#,##0", align: "right", font: { name: FONT, size: 10, bold: true, color: { argb: INK } } },
      { value: b.rate / 100, numFmt: "0.0%", align: "right", font: { name: FONT, size: 10, bold: true, color: { argb: g.color } } },
    ]);
  });

  const issued = rows.reduce((s, b) => s + b.issued, 0);
  const claimed = rows.reduce((s, b) => s + b.claimed, 0);
  const totalRate = issued > 0 ? claimed / issued : 0;

  writeTotalRow(ws, HEAD + 1 + rows.length, [
    { value: "รวมทั้งหมด", align: "left" },
    { value: "", align: "left" },
    { value: `${new Set(rows.map((b) => b.branch_name)).size} สาขา`, align: "left" },
    { value: issued, numFmt: "#,##0", align: "right" },
    { value: claimed, numFmt: "#,##0", align: "right" },
    { value: rows.reduce((s, b) => s + b.stamps, 0), numFmt: "#,##0", align: "right" },
    { value: totalRate, numFmt: "0.0%", align: "right", font: { color: { argb: grade(totalRate * 100).color } } },
  ]);

  ws.views = [{ state: "frozen", ySplit: HEAD, showGridLines: false }];
  if (rows.length > 0) ws.autoFilter = `A${HEAD}:G${HEAD + rows.length}`;
  ws.pageSetup = { ...A4_PORTRAIT, printTitlesRow: `${HEAD}:${HEAD}` };
}

/* ── ชีตสุดท้าย: สแกนรายบัญชี LINE ───────────────────────────────────── */

function buildLineSheet(wb: XWorkbook, scans: DailyLineScanItem[], rangeLabel: string, windowDays: number) {
  const ws = wb.addWorksheet("สแกนรายบัญชี LINE", { properties: { defaultRowHeight: 18 } });
  ws.columns = [{ width: 13 }, { width: 11 }, { width: 34 }, { width: 16 }, { width: 16 }];
  ws.views = [{ showGridLines: false }];

  const HEAD = writeTitleBlock(
    ws, "รายชื่อบัญชี LINE ที่สแกน QR สำเร็จ", rangeLabel,
    `แสดง ${windowDays} วันล่าสุด — ข้อมูลเก่ากว่านั้นยังอยู่ครบในระบบ`, "E",
  );
  writeHeaderRow(ws, HEAD, ["วันที่", "วัน", "ชื่อบัญชี LINE", "สแกนสำเร็จ\n(ใบ)", "ดวงที่ได้\n(ดวง)"]);

  scans.forEach((s, i) => {
    writeDataRow(ws, HEAD + 1 + i, i % 2 === 1, [
      { value: toExcelDate(s.date), numFmt: "dd/mm/yyyy", align: "left" },
      { value: thaiWeekday(s.date), align: "left" },
      { value: s.line_name, align: "left" },
      { value: s.qr_scans, numFmt: "#,##0", align: "right" },
      {
        value: s.stamps, numFmt: "#,##0", align: "right",
        font: { name: FONT, size: 10, bold: true, color: { argb: s.stamps > s.qr_scans ? PROMO : INK } },
      },
    ]);
  });

  writeTotalRow(ws, HEAD + 1 + scans.length, [
    { value: "รวมทั้งหมด", align: "left" },
    { value: "", align: "left" },
    { value: `${new Set(scans.map((s) => s.line_name)).size} บัญชี`, align: "left" },
    { value: scans.reduce((s, x) => s + x.qr_scans, 0), numFmt: "#,##0", align: "right" },
    { value: scans.reduce((s, x) => s + x.stamps, 0), numFmt: "#,##0", align: "right" },
  ]);

  ws.views = [{ state: "frozen", ySplit: HEAD, showGridLines: false }];
  if (scans.length > 0) ws.autoFilter = `A${HEAD}:E${HEAD + scans.length}`;
  ws.pageSetup = { ...A4_PORTRAIT, printTitlesRow: `${HEAD}:${HEAD}` };
}

/* ── ทางเข้าหลัก ─────────────────────────────────────────────────────── */

/** ประกอบสมุดงานทั้งเล่ม — แยกจากขั้นดาวน์โหลดเพื่อให้รันทดสอบนอกเบราว์เซอร์ได้ */
export function buildWorkbook(ExcelJS: ExcelJsModule, data: ReportData): XWorkbook {
  // ข้อมูลเรียงใหม่→เก่ามาจากฐานข้อมูล ช่วงวันที่จึงอยู่หัวท้ายของอาร์เรย์ที่เรียงแล้ว
  const dates = data.dailyStats.map((d) => d.date).sort();
  const rangeLabel = dates.length === 0
    ? "ยังไม่มีข้อมูล"
    : dates.length === 1
      ? `ข้อมูลวันที่ ${thaiDate(dates[0])}`
      : `ข้อมูลระหว่าง ${thaiDate(dates[0])} – ${thaiDate(dates[dates.length - 1])} (${dates.length} วัน)`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "ระบบบัตรสแตมป์ร้านหมาล่า La-Mi";
  wb.created = new Date();

  buildOverviewSheet(wb, data, rangeLabel);
  buildDailySheet(wb, data.dailyStats, rangeLabel);
  // สาขาเดียวจะซ้ำกับชีตสรุปรายวันทุกแถว ใส่ไปก็มีแต่ทำให้ไฟล์อ่านยากขึ้น
  if (data.branchStats.length > 1) {
    buildBranchSheet(wb, data.branchDaily, rangeLabel, data.windowDays);
  }
  buildLineSheet(wb, data.dailyLineScans, rangeLabel, data.windowDays);

  return wb;
}

/** ชื่อไฟล์ — ลงท้ายด้วยวันล่าสุดของข้อมูล ไม่ใช่วันที่กดปุ่ม */
export function reportFilename(stats: DailyStatItem[]): string {
  const dates = stats.map((d) => d.date).sort();
  const last = dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10);
  return `รายงานQR_La-Mi_${last}.xlsx`;
}

/** สร้างไฟล์แล้วสั่งดาวน์โหลด — คืนชื่อไฟล์ที่ดาวน์โหลดไป */
export async function downloadQrReport(data: ReportData): Promise<string> {
  const ExcelJS = await loadExcelJs();
  const wb = buildWorkbook(ExcelJS, data);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const filename = reportFilename(data.dailyStats);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ปล่อยทีหลังเพราะบางเบราว์เซอร์ยังอ่าน blob อยู่ตอน click คืนค่า
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return filename;
}

"use client";

/**
 * ต่อกับ LIFF SDK
 *
 * โหลด SDK จาก CDN ของ LINE แล้วเรียก init ครั้งเดียวต่อการเปิดหน้า
 *
 * ถ้ายังไม่ได้ตั้ง NEXT_PUBLIC_LIFF_ID จะข้ามทั้งหมดแล้วบอกว่าพร้อมทันที
 * เพื่อให้ทดสอบบนเครื่องได้โดยไม่ต้องต่อ LINE (คู่กับ DEV_FAKE_LINE_USER)
 */

interface Liff {
  init: (c: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (c?: { redirectUri?: string }) => void;
  getAccessToken: () => string | null;
  isInClient: () => boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var liff: Liff | undefined;
}

const SDK = "https://static.line-scdn.net/liff/edge/2/sdk.js";

/**
 * เก็บแยกตาม liffId เพราะมี LIFF app มากกว่าหนึ่งตัว
 * ตัวแรกชี้ไปหน้าบัตรสะสม ตัวที่สองชี้ไปหน้าสั่งเดลิเวอรี่
 * ต้อง init ด้วย id ของตัวที่เปิดอยู่จริง ไม่งั้น LINE จะไม่ยอม
 */
const ready = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("โหลด LIFF SDK ไม่สำเร็จ"));
    document.head.appendChild(el);
  });
}

/**
 * เรียกได้หลายครั้ง ทำงานจริงครั้งเดียวต่อหนึ่ง liffId
 *
 * ส่ง id มาเองได้สำหรับหน้าที่ใช้ LIFF app คนละตัว — ไม่ส่งก็ใช้ตัวหลัก
 * ถ้าตัวที่ส่งมายังไม่ได้ตั้งค่า จะถอยไปใช้ตัวหลักแทน เพื่อให้หน้ายังเปิดได้
 * ระหว่างที่ยังไม่ได้สร้าง LIFF app ตัวที่สองในคอนโซล
 */
export function initLiff(preferredId?: string): Promise<void> {
  const liffId = (preferredId?.trim() || process.env.NEXT_PUBLIC_LIFF_ID?.trim() || "");

  if (!liffId || liffId.startsWith("0000000000")) {
    // โหมดพัฒนา — ไม่ต้องผ่าน LINE
    return Promise.resolve();
  }

  const cached = ready.get(liffId);
  if (cached) return cached;

  const run = (async () => {
    await loadScript(SDK);
    const liff = globalThis.liff;
    if (!liff) throw new Error("ไม่พบ LIFF SDK");

    await liff.init({ liffId });

    // ยังไม่ได้ล็อกอิน -> พาไปล็อกอินแล้วกลับมาที่ URL เดิม
    // ต้องคง query string ไว้ ไม่งั้นรหัสที่ติดมากับ QR จะหาย
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      // หน้าจะถูกพาออกไป โค้ดหลังจากนี้ไม่ทำงาน
      await new Promise(() => {});
    }
  })();

  ready.set(liffId, run);
  return run;
}

/** token สำหรับแนบไปกับคำขอ ให้เซิร์ฟเวอร์เอาไปแลกตัวตนกับ LINE (§6) */
export function accessToken(): string | null {
  try {
    return globalThis.liff?.getAccessToken?.() ?? null;
  } catch {
    return null;
  }
}

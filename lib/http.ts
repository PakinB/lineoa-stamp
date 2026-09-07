/** ตัวช่วยตอบกลับ API — รูปแบบเดียวกันทุกเส้น */

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * ตอบกลับกรณีล้มเหลว
 *
 * ข้อความผิดพลาดของเส้นทางที่เกี่ยวกับความปลอดภัย (เคลม QR, รับรางวัล)
 * ต้องไม่บอกใบ้ว่าผิดตรงไหน — ใช้ reason กลาง ๆ แล้วให้หน้าเว็บแปลเป็นภาษาคน
 */
export function fail(reason: string, status = 400) {
  return json({ ok: false, reason }, status);
}

export class HttpError extends Error {
  constructor(public reason: string, public status = 400) {
    super(reason);
  }
}

/** ห่อ handler ให้ error กลายเป็น response แทนที่จะ 500 เปล่า ๆ */
export function handler(fn: () => Promise<Response>) {
  return fn().catch((e) => {
    if (e instanceof HttpError) return fail(e.reason, e.status);
    console.error(e);
    return fail("internal_error", 500);
  });
}

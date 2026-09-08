import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * ค่าเริ่มต้นพอสำหรับระบบนี้
 *
 * ยังไม่เปิดแคชแบบต่อเนื่อง (R2/KV) เพราะทุกหน้าที่มีข้อมูลจริง
 * ต้องสดเสมอ — บัตรสแตมป์กับสถานะ QR แคชไม่ได้อยู่แล้ว
 */
export default defineCloudflareConfig();

export default function Home() {
  return (
    <div className="screen center">
      <p className="big">บัตรสะสมหมาล่า</p>
      <p className="hint" style={{ margin: "10px 0 26px" }}>
        สะสมครบ 10 ดวง รับของรางวัลได้ทุกสาขา
      </p>
      <a href="/card" className="btn" style={{ textDecoration: "none", maxWidth: 320, marginBottom: 10 }}>
        ดูบัตรสะสมของฉัน
      </a>
      {/* จุดเริ่มต้นของพนักงานต้องเลือกชื่อและใส่ PIN เสมอ */}
      <a href="/staff/login" className="btn ghost" style={{ textDecoration: "none", maxWidth: 320 }}>
        เข้าหน้าพนักงาน
      </a>
    </div>
  );
}

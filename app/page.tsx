import Link from "next/link";

export default function Home() {
  return (
    <div className="screen center">
      <p className="big">บัตรสะสมหมาล่า</p>
      <p className="hint" style={{ margin: "10px 0 26px" }}>
        หน้าจอลูกค้ายังไม่ได้ทำ — ตอนนี้มีเฉพาะฝั่งพนักงาน
      </p>
      <Link href="/staff" className="btn" style={{ textDecoration: "none", maxWidth: 320 }}>
        เข้าหน้าพนักงาน
      </Link>
    </div>
  );
}

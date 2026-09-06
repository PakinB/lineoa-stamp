import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "บัตรสะสมหมาล่า",
  description: "บัตรสะสมแต้มร้านหมาล่า สะสมและรับรางวัลได้ทุกสาขา",
};

// LIFF เปิดในเว็บวิวของ LINE — ต้องกันการซูมและเผื่อ safe area ของ iPhone
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}

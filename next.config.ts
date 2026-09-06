import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // LIFF ทำงานใน webview ของ LINE — ต้องยอมให้ฝังใน iframe ของ LINE ได้
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;

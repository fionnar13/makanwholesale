import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // کتابخانه‌های سمت سرور یکپارچه‌سازی‌ها — از bundle شدن خروجی standalone خارج می‌شوند
  serverExternalPackages: ["google-auth-library", "exceljs"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // خطاهای TypeScript دیگر پنهان نمی‌شوند — `npm run typecheck` در CI نیز اجرا می‌شود
  reactStrictMode: false,
  // کتابخانه‌های سمت سرور یکپارچه‌سازی‌ها — از bundle شدن خروجی standalone خارج می‌شوند
  serverExternalPackages: ["google-auth-library", "exceljs"],
};

export default nextConfig;

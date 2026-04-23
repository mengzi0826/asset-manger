// 统一进程时区为中国标准时间（Asia/Shanghai）
// 影响 server 端 Date 的本地方法（getHours/getDate 等）和 Intl 默认时区。
// 不会改变 new Date().toISOString() 的 UTC 行为；具体时间序列化由 lib/time.ts 负责。
process.env.TZ = process.env.TZ || "Asia/Shanghai";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"]
  }
};

export default nextConfig;

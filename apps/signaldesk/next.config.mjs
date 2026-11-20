/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['postgres', 'bullmq', 'ioredis'],
  },
};

export default nextConfig;
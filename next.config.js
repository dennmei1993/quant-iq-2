/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk'],
  images: {
    remotePatterns: [],
  },
}

module.exports = nextConfig
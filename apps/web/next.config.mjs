/** @type {import('next').NextConfig} */
const nextConfig = {
  // Linting runs at the repo root (`npm run lint`: eslint + boundary rules);
  // next build only needs to compile + typecheck.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

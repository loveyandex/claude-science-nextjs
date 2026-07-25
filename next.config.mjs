/** @type {import('next').NextConfig} */
const nextConfig = {
  // We already load fonts via a <link> tag in the root layout (not
  // next/font), so Next's own font optimizer has nothing to do here except
  // attempt (and, on a restricted network, fail) to download the same
  // stylesheet a second time during build. Off avoids the noisy warning.
  optimizeFonts: false,
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "@prisma/adapter-pg",
      "pg",
      "unpdf",
    ],
  },
};

export default nextConfig;

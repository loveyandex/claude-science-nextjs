import { withWorkflow } from "workflow/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a second dev server (e.g. a test run on another port) build into
  // its own directory instead of fighting the main one over `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
    instrumentationHook: true,
  },
};

// Compiles "use workflow" / "use step" functions (src/workflows/) and
// generates the runtime's routes under src/app/.well-known/workflow/.
export default withWorkflow(nextConfig);

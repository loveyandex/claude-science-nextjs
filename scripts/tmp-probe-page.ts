import "dotenv/config";
import { spawnSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { resolvePdfPath } from "../src/lib/springer-pdf";

(async () => {
  const p = await prisma.aiProvider.findFirstOrThrow({ where: { label: "OpenAI-compatible (.env)" } });
  const r = spawnSync("venv\\Scripts\\python.exe", ["tmp_test_transcribe.py"], {
    cwd: "backend",
    env: {
      ...process.env,
      TEST_BASE: p.baseUrl!,
      TEST_KEY: p.apiKey ?? "",
      TEST_PAGE: process.argv[2] ?? "4",
      TEST_PDF: resolvePdfPath("10.1007/s10853-025-11876-5.pdf"),
    },
    encoding: "utf8",
  });
  console.log(r.stdout, r.stderr);
  process.exit(0);
})();

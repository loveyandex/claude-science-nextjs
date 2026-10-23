import "dotenv/config";
import { prisma } from "../src/lib/prisma";

(async () => {
  const p = await prisma.aiProvider.findFirstOrThrow({ where: { label: "OpenAI-compatible (.env)" } });
  for (const model of ["gemma4:31b", "gpt-oss:120b"]) {
    const t0 = Date.now();
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Say hi" }], stream: false }),
      signal: AbortSignal.timeout(90000),
    }).catch((e) => e);
    if (res instanceof Error) console.log(model, "error", res.message, `${(Date.now() - t0) / 1000}s`);
    else console.log(model, res.status, (await res.text()).slice(0, 200), `${(Date.now() - t0) / 1000}s`);
  }
  process.exit(0);
})();

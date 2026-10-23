import { readFile } from "node:fs/promises";
import { checkInternalSecret, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePdfPath } from "@/lib/springer-pdf";

export const dynamic = "force-dynamic";

// The backend/ service's way to get a DOI's PDF: it lives on this
// machine's disk, so the Python side pulls it through here (server to
// server, X-Internal-Secret) instead of needing its own path to the files.
export async function GET(req: Request) {
  if (!checkInternalSecret(req)) return unauthorized("Invalid internal secret.");

  const doi = new URL(req.url).searchParams.get("doi") ?? "";
  const article = await prisma.articleByDOI.findUnique({ where: { doi }, select: { pdfPath: true } });
  if (!article) return Response.json({ error: `No ArticleByDOI row for "${doi}"` }, { status: 404 });

  try {
    const bytes = await readFile(resolvePdfPath(article.pdfPath));
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length) },
    });
  } catch {
    return Response.json({ error: "PDF file is missing on disk" }, { status: 410 });
  }
}

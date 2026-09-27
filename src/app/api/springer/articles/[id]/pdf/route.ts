import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { resolvePdfPath } from "@/lib/springer-pdf";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const article = await prisma.springerArticle.findUnique({
    where: { id: params.id },
    select: { doi: true, pdfPath: true, pdfStatus: true },
  });
  if (!article?.pdfPath || article.pdfStatus !== "downloaded") {
    return Response.json({ error: "No downloaded PDF for this article" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(resolvePdfPath(article.pdfPath));
  } catch {
    return Response.json({ error: "PDF file is missing on disk — re-run stage 3" }, { status: 410 });
  }

  const filename = `${article.doi.replace(/[^\w.-]+/g, "_")}.pdf`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

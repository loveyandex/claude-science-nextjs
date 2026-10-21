import { readFile } from "node:fs/promises";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { parseDoi } from "@/lib/doi";
import { pdfRelativePath, resolvePdfPath } from "@/lib/springer-pdf";

export const dynamic = "force-dynamic";

// Serves a PDF saved by /api/doi/fetch-pdf (or Springer stage 3) straight
// from disk, looked up by DOI rather than by SpringerArticle id.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const doi = parseDoi(new URL(req.url).searchParams.get("doi") ?? "");
  if (!doi) return Response.json({ error: "Missing or invalid doi" }, { status: 400 });

  let bytes: Buffer;
  try {
    bytes = await readFile(resolvePdfPath(pdfRelativePath(doi)));
  } catch {
    return Response.json({ error: "No downloaded PDF for this DOI" }, { status: 404 });
  }

  const filename = `${doi.replace(/[^\w.-]+/g, "_")}.pdf`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

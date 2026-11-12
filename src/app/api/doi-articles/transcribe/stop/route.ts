import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { parseDoi } from "@/lib/doi";
import { stopActiveTranscription } from "@/lib/doi-transcribe";

export const dynamic = "force-dynamic";

// Stops a live "make science" run for one DOI, whoever started it (the
// panel or the stage-4 job): pages already at the provider finish and are
// saved, the rest are skipped, and the article is left "partial".
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const doi = typeof body?.doi === "string" ? parseDoi(body.doi) : null;
  if (!doi) return Response.json({ error: "Missing or invalid doi" }, { status: 400 });

  const run = stopActiveTranscription(doi);
  if (!run) return Response.json({ error: "Nothing is reading this PDF right now" }, { status: 404 });
  return Response.json({ run });
}

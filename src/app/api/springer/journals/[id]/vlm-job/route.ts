import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { internalSecretConfigured, loadVisionProvider } from "@/lib/doi-transcribe";
import { parseScopeDois } from "@/lib/springer-save";
import { startVlmJob } from "@/lib/springer-vlm";

export const dynamic = "force-dynamic";

// Starts stage 4 for this journal: a background job that reads each
// downloaded, not-yet-fully-read PDF with a vision model. Answers at once;
// poll GET /api/springer/vlm-job for progress.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  if (!internalSecretConfigured()) {
    return Response.json(
      { error: "INTERNAL_API_SECRET is not configured — set it in .env (same value backend/.env uses)." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const modelName = typeof body?.modelName === "string" ? body.modelName.trim() : "";
  if (!modelName) return Response.json({ error: "Pick a model to read the PDFs with" }, { status: 400 });
  const concurrency = Math.min(8, Math.max(1, typeof body?.concurrency === "number" ? body.concurrency : 1));
  const dois = parseScopeDois(body?.dois);
  if (dois && "error" in dois) return Response.json({ error: dois.error }, { status: 400 });

  const loaded = await loadVisionProvider(body?.providerId);
  if ("error" in loaded) return Response.json({ error: loaded.error }, { status: 400 });

  const result = await startVlmJob({
    journalDbId: params.id,
    provider: loaded.provider,
    modelName,
    concurrency,
    dois,
    retryFailed: body?.retryFailed !== false,
    scopeLabel:
      typeof body?.scopeLabel === "string" && body.scopeLabel.trim()
        ? body.scopeLabel.trim().slice(0, 120)
        : dois
          ? `${dois.length} selected article(s)`
          : "all downloaded PDFs",
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ job: result.job });
}

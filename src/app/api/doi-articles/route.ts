import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { ensureArticleByDoi } from "@/lib/article-by-doi";
import { parseDoi } from "@/lib/doi";
import { getActiveTranscription } from "@/lib/doi-transcribe";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET ?doi=… — one ArticleByDOI's transcription state, for the
// "make science" panel on /doi and /springer/one-link.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const doi = parseDoi(new URL(req.url).searchParams.get("doi") ?? "");
  if (!doi) return Response.json({ error: "Missing or invalid doi" }, { status: 400 });

  const article = await ensureArticleByDoi(doi);
  if (!article) return Response.json({ article: null, activeRun: null });

  const pages = await prisma.articleByDOIPage.findMany({
    where: { articleId: article.id },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true },
  });
  return Response.json({
    article: {
      id: article.id,
      doi: article.doi,
      source: article.source,
      title: article.title,
      abstract: article.abstract,
      pdfPath: article.pdfPath,
      pdfSize: article.pdfSize,
      pageCount: article.pageCount,
      status: article.status,
      error: article.error,
      transcribeProvider: article.transcribeProvider,
      transcribeModel: article.transcribeModel,
      pagesDone: pages.map((p) => p.pageNumber),
    },
    // A run still going in this server (e.g. started before a page reload,
    // or by the stage-4 job) — the panel follows it instead of offering to
    // start a second one.
    activeRun: getActiveTranscription(doi),
  });
}

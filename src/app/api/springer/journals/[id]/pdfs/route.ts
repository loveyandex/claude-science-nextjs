import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { vlmInfoByDoi, vlmInfoFor, type VlmCounts, type VlmState } from "@/lib/springer-vlm";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const STATES: VlmState[] = ["done", "partial", "failed", "todo"];

// A journal's downloaded PDFs with their stage-4 (vision-model reading)
// state. The state is derived per request from ArticleByDOI and its saved
// pages, so filtering by it happens here rather than in SQL.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const journal = await prisma.springerJournal.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!journal) return Response.json({ error: "Journal not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const stateParam = searchParams.get("state");
  const state = STATES.includes(stateParam as VlmState) ? (stateParam as VlmState) : null;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  const downloaded = await prisma.springerArticle.findMany({
    where: { journalId: journal.id, pdfStatus: "downloaded" },
    orderBy: { createdAt: "asc" },
    select: { id: true, doi: true, title: true, publishedDate: true, pdfSize: true },
  });
  const infos = await vlmInfoByDoi(downloaded.map((d) => d.doi));
  const rows = downloaded.map((d) => ({ ...d, vlm: vlmInfoFor(infos, d.doi) }));

  const counts: VlmCounts = { downloaded: rows.length, done: 0, partial: 0, failed: 0, todo: 0 };
  for (const r of rows) counts[r.vlm.state]++;

  const filtered = state ? rows.filter((r) => r.vlm.state === state) : rows;
  return Response.json({
    counts,
    articles: filtered.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) },
  });
}

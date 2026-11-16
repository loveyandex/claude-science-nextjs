import { findSpringerArticles } from "@/lib/springer-article-repository";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export async function listSpringerArticles(searchParams: URLSearchParams) {
  const q = searchParams.get("q")?.trim() || undefined;
  const journalId = searchParams.get("journalId")?.trim() || undefined;
  const status = searchParams.get("status")?.trim() || undefined;
  // "todo" = what stage 3 would pick up next (never tried, or a retryable failure)
  const pdf = searchParams.get("pdf")?.trim() || undefined;
  // "oldest" matches the order stages 2 and 3 work through their queues in
  const oldestFirst = searchParams.get("order") === "oldest";
  const page = Math.min(1_000_000, Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  const where = {
    ...(journalId ? { journalId } : {}),
    ...(status ? { status } : {}),
    AND: [
      ...(q
        ? [
            {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { abstract: { contains: q, mode: "insensitive" as const } },
                { doi: { contains: q, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
      ...(pdf === "todo" ? [{ OR: [{ pdfStatus: null }, { pdfStatus: "failed" }] }] : []),
    ],
  };

  const { articles, total } = await findSpringerArticles(where, oldestFirst, (page - 1) * limit, limit);
  return { articles, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

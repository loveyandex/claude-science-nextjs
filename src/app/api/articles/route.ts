import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Lists real indexed articles for the /library page. Only rows that
// actually finished a pipeline (old /make-science "indexed" status, or
// gemma4 "indexed"/"partial") have a real title/abstract — everything
// else is just a placeholder shell row waiting to be processed.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  const where = {
    OR: [{ status: "indexed" }, { gemmaStatus: { in: ["indexed", "partial"] } }],
    ...(q
      ? {
          AND: [
            {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { abstract: { contains: q, mode: "insensitive" as const } },
              ],
            },
          ],
        }
      : {}),
  };

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        url: true,
        pdfUrl: true,
        title: true,
        abstract: true,
        pageCount: true,
        status: true,
        gemmaStatus: true,
        createdAt: true,
      },
    }),
    prisma.article.count({ where }),
  ]);

  return Response.json({
    articles,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}

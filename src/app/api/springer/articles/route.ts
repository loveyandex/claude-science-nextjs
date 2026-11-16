import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { listSpringerArticles } from "@/lib/springer-article-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await getAuthFromRequest(req))) return unauthorized();
  return Response.json(await listSpringerArticles(new URL(req.url).searchParams));
}

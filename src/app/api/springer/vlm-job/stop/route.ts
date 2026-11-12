import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { stopVlmJob } from "@/lib/springer-vlm";

export const dynamic = "force-dynamic";

// Stops the PDF-reading job: no new pages go to the provider, pages already
// there finish and are saved, and the current article is left "partial".
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();
  const job = stopVlmJob();
  if (!job) return Response.json({ error: "No PDF-reading job to stop" }, { status: 404 });
  return Response.json({ job });
}

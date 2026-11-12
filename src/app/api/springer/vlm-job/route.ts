import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { getVlmJob } from "@/lib/springer-vlm";

export const dynamic = "force-dynamic";

// The current (or last finished) stage-4 PDF-reading job, polled by the page.
// Lives in this server process's memory: a restart forgets it, but every
// page it read is already saved, so starting again resumes.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();
  return Response.json({ job: getVlmJob() });
}

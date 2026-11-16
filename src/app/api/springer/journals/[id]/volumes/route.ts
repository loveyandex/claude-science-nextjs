import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { loadJournalVolumes, SpringerCrawlError } from "@/lib/springer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Live read of the journal's volumes-and-issues index (volume → year range,
// issue → month), so the issue-mode crawl can be aimed by year/month.
// Not stored: it changes as issues are published, and the page caches it.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const journal = await prisma.springerJournal.findUnique({ where: { id: params.id } });
  if (!journal) return Response.json({ error: "Journal not found" }, { status: 404 });

  const headless = new URL(req.url).searchParams.get("headless") === "1";
  try {
    const volumes = await loadJournalVolumes(journal.journalId, { headless }, true);
    if (volumes.length === 0) {
      return Response.json({ error: "No volumes found on the journal's volumes-and-issues page" }, { status: 502 });
    }
    return Response.json({ volumes });
  } catch (err) {
    const message =
      err instanceof SpringerCrawlError || err instanceof Error ? err.message : "Failed to load volumes";
    return Response.json({ error: message }, { status: 502 });
  }
}

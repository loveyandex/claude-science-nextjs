import type { ToolExecutionOptions } from "ai";
import { prisma } from "@/lib/prisma";
import { extractPageText } from "@/lib/pdf";
import { webSearch } from "@/lib/web-search";
import { semanticSearchLibrary } from "@/lib/qdrant-search";
import { doiArticleTools } from "@/lib/chat-tools/doi-articles";
import type { ToolContext, ToolName } from "@/lib/research/tool-defs";
import {
  addEvent,
  cancelResearchRun,
  getWorkflowState,
  startResearchRun,
} from "@/lib/research/service";

// Implementations behind TOOL_DEFS. Called only from inside workflow steps
// (src/workflows/research-steps.ts), never from the workflow body.

const ARTICLE_SELECT = { title: true, abstract: true, url: true, pdfUrl: true } as const;
const MAX_FULL_CONTENT_CHARS = 40000;
const MAX_WEB_PAGE_CHARS = 12000;

type Input = Record<string, any>;

const DOI_TOOL_OPTIONS = { toolCallId: "research", messages: [] } as unknown as ToolExecutionOptions<never>;

function doiTool(name: keyof typeof doiArticleTools) {
  return async (input: Input): Promise<unknown> => doiArticleTools[name].execute!(input as never, DOI_TOOL_OPTIONS);
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

const IMPLEMENTATIONS: Record<ToolName, (input: Input, ctx: ToolContext) => Promise<unknown>> = {
  async searchLibrarySemantic({ query, limit }) {
    const result = await semanticSearchLibrary(query, limit ?? 5);
    if (!result.ok) {
      return {
        query: result.query,
        count: 0,
        results: [],
        error: result.error,
        hint: "Semantic search is unavailable right now — try searchArticles or searchSpringerArticles instead.",
      };
    }
    return { query: result.query, count: result.count, results: result.results };
  },

  async searchArticles({ query, limit }) {
    const results = await prisma.article.findMany({
      where: {
        status: "indexed",
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { abstract: { contains: query, mode: "insensitive" } },
        ],
      },
      take: limit ?? 5,
      orderBy: { createdAt: "desc" },
      select: ARTICLE_SELECT,
    });
    return { query, count: results.length, results };
  },

  async listRecentArticles({ limit }) {
    const results = await prisma.article.findMany({
      where: { status: "indexed" },
      take: limit ?? 10,
      orderBy: { createdAt: "desc" },
      select: ARTICLE_SELECT,
    });
    return { count: results.length, results };
  },

  async getLibraryStats() {
    const [total, failed, latest, springer, springerPdfs, doiPdfs] = await Promise.all([
      prisma.article.count({ where: { status: "indexed" } }),
      prisma.article.count({ where: { status: "failed" } }),
      prisma.article.findFirst({
        where: { status: "indexed" },
        orderBy: { createdAt: "desc" },
        select: { title: true, createdAt: true },
      }),
      prisma.springerArticle.count(),
      prisma.springerArticle.count({ where: { pdfStatus: "downloaded" } }),
      prisma.articleByDOI.count(),
    ]);
    return {
      library: {
        indexed: total,
        failed,
        mostRecent: latest ? { title: latest.title, indexedAt: latest.createdAt.toISOString() } : null,
      },
      springer: { articles: springer, pdfsDownloaded: springerPdfs },
      doiPdfs,
    };
  },

  async getArticleByUrl({ url }) {
    const article = await prisma.article.findUnique({ where: { url }, select: ARTICLE_SELECT });
    return article ?? { error: `No indexed article found for url "${url}".` };
  },

  async readArticlePage({ url, page }) {
    const article = await prisma.article.findUnique({
      where: { url },
      select: { pdfUrl: true, title: true },
    });
    if (!article) return { error: `No indexed article found for url "${url}".` };
    const res = await fetch(article.pdfUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return { error: `Fetching the PDF failed: ${res.status} ${res.statusText}` };
    const extraction = await extractPageText(await res.arrayBuffer(), page);
    if (!extraction.ok) return { error: extraction.error };
    return { title: article.title, page, pageCount: extraction.pageCount, text: extraction.pageText };
  },

  async getArticleFullContent({ url }) {
    const article = await prisma.article.findUnique({
      where: { url },
      select: {
        title: true,
        pageCount: true,
        pages: { orderBy: { pageNumber: "asc" }, select: { pageNumber: true, content: true } },
      },
    });
    if (!article) return { error: `No indexed article found for url "${url}".` };
    if (article.pages.length === 0) {
      return { error: `"${article.title}" has no page transcriptions — use readArticlePage instead.` };
    }
    const full = article.pages.map((p) => `## Page ${p.pageNumber}\n\n${p.content}`).join("\n\n");
    return {
      title: article.title,
      url,
      pageCount: article.pageCount ?? article.pages.length,
      content: full.slice(0, MAX_FULL_CONTENT_CHARS),
      truncated: full.length > MAX_FULL_CONTENT_CHARS,
    };
  },

  searchSpringerArticles: doiTool("searchSpringerArticles"),
  searchDoiArticles: doiTool("searchDoiArticles"),
  getArticleByDoi: doiTool("getArticleByDoi"),
  readDoiArticlePages: doiTool("readDoiArticlePages"),

  async webSearch({ query, limit }) {
    const results = await webSearch(query, limit ?? 5);
    return { query, count: results.length, results };
  },

  async fetchWebPage({ url }) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; locaul-science-research/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return { url, error: `${res.status} ${res.statusText}` };
    const type = res.headers.get("content-type") ?? "";
    if (!/text|html|json|xml/.test(type)) return { url, error: `Unsupported content type "${type}".` };
    const raw = await res.text();
    const text = /html/.test(type) ? htmlToText(raw) : raw;
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
    return {
      url: res.url,
      title,
      text: text.slice(0, MAX_WEB_PAGE_CHARS),
      truncated: text.length > MAX_WEB_PAGE_CHARS,
    };
  },

  async updatePlan({ steps }, ctx) {
    if (!ctx.runId) return { error: "updatePlan is only available inside a research run." };
    await prisma.researchRun.update({ where: { id: ctx.runId }, data: { plan: steps } });
    const done = steps.filter((s: { status: string }) => s.status === "done").length;
    await addEvent(ctx.workflowId, ctx.runId, "plan", `Plan updated · ${done}/${steps.length} done`, null, { steps });
    return { ok: true, steps: steps.length, done };
  },

  async recordFinding({ title, content, sources, confidence, tags }, ctx) {
    const finding = await prisma.researchFinding.create({
      data: {
        workflowId: ctx.workflowId,
        runId: ctx.runId,
        title,
        content,
        sources: sources ?? [],
        confidence: confidence ?? null,
        tags: tags ?? [],
      },
    });
    await addEvent(ctx.workflowId, ctx.runId, "finding", title, content, {
      findingId: finding.id,
      confidence: confidence ?? null,
      sources: sources ?? [],
    });
    return { ok: true, findingId: finding.id };
  },

  async listFindings({ query, limit }, ctx) {
    const q = query?.trim();
    const rows = await prisma.researchFinding.findMany({
      where: {
        workflowId: ctx.workflowId,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { content: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit ?? 20,
      include: { run: { select: { number: true } } },
    });
    return {
      count: rows.length,
      findings: rows.map((f) => ({
        id: f.id,
        title: f.title,
        content: f.content.slice(0, 1500),
        sources: f.sources,
        confidence: f.confidence,
        tags: f.tags,
        run: f.run?.number ?? null,
        createdAt: f.createdAt.toISOString(),
      })),
    };
  },

  async writeNote({ title, body }, ctx) {
    await addEvent(ctx.workflowId, ctx.runId, "note", title, body ?? null);
    return { ok: true };
  },

  async getWorkflowState(_input, ctx) {
    return (await getWorkflowState(ctx.workflowId)) ?? { error: "Workflow not found." };
  },

  async getRecentActivity({ limit, runNumber }, ctx) {
    const run = runNumber
      ? await prisma.researchRun.findUnique({
          where: { workflowId_number: { workflowId: ctx.workflowId, number: runNumber } },
          select: { id: true },
        })
      : null;
    if (runNumber && !run) return { error: `There's no run #${runNumber}.` };
    const events = await prisma.researchWorkflowEvent.findMany({
      where: { workflowId: ctx.workflowId, ...(run ? { runId: run.id } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit ?? 25,
      include: { run: { select: { number: true } } },
    });
    return {
      count: events.length,
      events: events.map((e) => ({
        at: e.createdAt.toISOString(),
        run: e.run?.number ?? null,
        type: e.type,
        title: e.title,
        detail: e.detail?.slice(0, 600) ?? null,
      })),
    };
  },

  async updateBrief({ brief, name }, ctx) {
    await prisma.researchWorkflow.update({
      where: { id: ctx.workflowId },
      data: { brief, ...(name ? { name } : {}) },
    });
    await addEvent(ctx.workflowId, null, "brief_updated", name ? `Brief updated · renamed to "${name}"` : "Brief updated", brief);
    return { ok: true, note: "Saved. It applies to the next run." };
  },

  async startResearchRun({ note }, ctx) {
    return startResearchRun(ctx.workflowId, note);
  },

  async cancelResearchRun({ reason }, ctx) {
    return cancelResearchRun(ctx.workflowId, reason ?? "Cancelled from chat");
  },

  async readRunReport({ runNumber }, ctx) {
    const run = await prisma.researchRun.findFirst({
      where: {
        workflowId: ctx.workflowId,
        ...(runNumber ? { number: runNumber } : { report: { not: null } }),
      },
      orderBy: { number: "desc" },
    });
    if (!run) return { error: runNumber ? `There's no run #${runNumber}.` : "No run has produced a report yet." };
    return {
      number: run.number,
      status: run.status,
      report: run.report ?? "(this run has no report)",
      error: run.error,
    };
  },
};

export async function executeResearchTool(name: ToolName, input: Input, ctx: ToolContext) {
  const impl = IMPLEMENTATIONS[name];
  if (!impl) return { error: `Unknown tool "${name}".` };
  return impl(input, ctx);
}

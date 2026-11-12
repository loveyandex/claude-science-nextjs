import { z } from "zod";

// Descriptions + input schemas for every tool the research agents can call.
// Pure (zod only) on purpose: workflow bodies import this to build their
// tool sets, and the workflow sandbox can't load Prisma or node:fs. The
// matching implementations live in tool-exec.ts and run inside steps.

const PDF_STATUSES = ["downloaded", "not_found", "failed", "untried"] as const;

const sourceSchema = z.object({
  doi: z.string().optional().describe("DOI of the article the claim comes from."),
  url: z.string().optional().describe("Library article url or web URL, when there's no DOI."),
  title: z.string().optional(),
  page: z.number().int().min(1).optional().describe("Page the claim was read on."),
  quote: z.string().optional().describe("Short verbatim quote supporting the claim."),
});

export const TOOL_DEFS = {
  // --- local library (Article table) -----------------------------------
  searchLibrarySemantic: {
    description:
      "Semantic (vector) search over the full text of every embedded page in the local library (Article table). Finds papers by meaning and returns matching passages with page numbers. The default way to find papers on a topic.",
    inputSchema: z.object({
      query: z.string().min(1).describe("The scientific concept, as a short descriptive phrase."),
      limit: z.number().int().min(1).max(10).optional().describe("Max distinct articles (default 5)."),
    }),
  },
  searchArticles: {
    description:
      "Keyword search over title and abstract of the local library (Article table). Use for exact strings (an author, a title, a term) or when semantic search is unavailable.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).optional(),
    }),
  },
  listRecentArticles: {
    description: "List the most recently indexed articles in the local library, no keyword required.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  },
  getLibraryStats: {
    description: "Counts of indexed vs failed articles in the local library and the most recent addition.",
    inputSchema: z.object({}),
  },
  getArticleByUrl: {
    description: "One library article's record (title, abstract, PDF URL) by its url, e.g. after a search hit.",
    inputSchema: z.object({ url: z.string().min(1) }),
  },
  readArticlePage: {
    description: "Read one page (1-indexed) of a library article's original PDF by url + page number.",
    inputSchema: z.object({ url: z.string().min(1), page: z.number().int().min(1) }),
  },
  getArticleFullContent: {
    description:
      "A library article's entire content as markdown, page by page — only for articles indexed via the page-image/vision pipeline (make-science-gemma4).",
    inputSchema: z.object({ url: z.string().min(1) }),
  },

  // --- Springer / DOI tables ---------------------------------------------
  searchSpringerArticles: {
    description:
      "Search articles crawled from registered Springer journals (SpringerArticle) by keyword across title, abstract and DOI, optionally filtered by PDF status. Returns per-status counts too.",
    inputSchema: z.object({
      query: z.string().optional().describe("Keywords or a DOI fragment. Omit to list recent articles."),
      pdfStatus: z.enum(PDF_STATUSES).optional(),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)."),
    }),
  },
  searchDoiArticles: {
    description:
      "Search every PDF downloaded by DOI (ArticleByDOI) by keyword across title, abstract and DOI, with how many pages have a vision-model transcription.",
    inputSchema: z.object({
      query: z.string().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
  },
  getArticleByDoi: {
    description:
      "Everything stored for one DOI: Springer record (journal, date, abstract, open-access content, PDF status) and PDF page count / transcription state. Call before readDoiArticlePages.",
    inputSchema: z.object({ doi: z.string().min(1).describe("A DOI, or a URL containing one.") }),
  },
  readDoiArticlePages: {
    description:
      "Read pages of a DOI's downloaded PDF, up to 5 pages per call (1-indexed, inclusive). Returns vision-model markdown where available, raw PDF text otherwise. Page through long articles with consecutive ranges until nextPage is null.",
    inputSchema: z.object({
      doi: z.string().min(1),
      fromPage: z.number().int().min(1),
      toPage: z.number().int().min(1).optional(),
    }),
  },

  // --- web ---------------------------------------------------------------
  webSearch: {
    description: "Search the public web (not the local library) for anything outside the indexed papers.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).optional(),
    }),
  },
  fetchWebPage: {
    description:
      "Fetch a public web page (e.g. a webSearch hit) and return its readable text, capped at ~12k characters.",
    inputSchema: z.object({ url: z.string().url() }),
  },

  // --- the workflow's own notebook ---------------------------------------
  updatePlan: {
    description:
      "Set the research plan for this run as a checklist. Call it first, then again whenever a step's status changes — it replaces the whole list. The user watches this plan live.",
    inputSchema: z.object({
      steps: z
        .array(
          z.object({
            title: z.string().min(1),
            status: z.enum(["todo", "doing", "done", "skipped"]),
            note: z.string().optional(),
          })
        )
        .min(1)
        .max(20),
    }),
  },
  recordFinding: {
    description:
      "Save one finding to this workflow's notebook: a self-contained claim or result, in markdown, with the sources it rests on. Findings persist across runs and are what the user reads, so record each substantive result as soon as you've verified it.",
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1).describe("Markdown: the finding, numbers and conditions included."),
      sources: z.array(sourceSchema).max(12).default([]),
      confidence: z.enum(["high", "medium", "low"]).optional(),
      tags: z.array(z.string()).max(8).optional(),
    }),
  },
  listFindings: {
    description:
      "List findings already saved in this workflow's notebook (from this and earlier runs), newest first, optionally filtered by a keyword. Check it before re-researching something.",
    inputSchema: z.object({
      query: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional().describe("Default 20."),
    }),
  },
  writeNote: {
    description:
      "Add a short entry to the run's lab notebook — progress, a dead end, a decision and why. Use sparingly, for things worth telling the user that aren't findings.",
    inputSchema: z.object({
      title: z.string().min(1).max(160),
      body: z.string().optional(),
    }),
  },

  // --- chat-pane control tools ---------------------------------------------
  getWorkflowState: {
    description:
      "Current state of this workflow: name, brief, model, status, the current/last run (plan, step and tool counts, tokens, error, report excerpt), the latest activity and the findings so far.",
    inputSchema: z.object({}),
  },
  getRecentActivity: {
    description: "The workflow's activity timeline (tool calls, notes, findings, run events), newest first.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(60).optional().describe("Default 25."),
      runNumber: z.number().int().min(1).optional().describe("Only events of this run."),
    }),
  },
  updateBrief: {
    description:
      "Replace the workflow's brief — the standing instructions research runs follow — and optionally rename it. Write the complete brief, not a diff.",
    inputSchema: z.object({
      brief: z.string().min(1),
      name: z.string().min(1).max(120).optional(),
    }),
  },
  startResearchRun: {
    description:
      "Start a new research run of this workflow in the background, following the current brief. Fails if one is already running.",
    inputSchema: z.object({
      note: z.string().optional().describe("Extra guidance for just this run."),
    }),
  },
  cancelResearchRun: {
    description: "Cancel the workflow's running research run. Work already saved (findings, notes) is kept.",
    inputSchema: z.object({ reason: z.string().optional() }),
  },
  readRunReport: {
    description: "Read the final report of a run (default: the latest run that produced one).",
    inputSchema: z.object({ runNumber: z.number().int().min(1).optional() }),
  },
} as const;

export type ToolName = keyof typeof TOOL_DEFS;

const READ_TOOLS: ToolName[] = [
  "searchLibrarySemantic",
  "searchArticles",
  "listRecentArticles",
  "getLibraryStats",
  "getArticleByUrl",
  "readArticlePage",
  "getArticleFullContent",
  "searchSpringerArticles",
  "searchDoiArticles",
  "getArticleByDoi",
  "readDoiArticlePages",
  "webSearch",
  "fetchWebPage",
];

export const RESEARCH_TOOLS: ToolName[] = [
  ...READ_TOOLS,
  "updatePlan",
  "recordFinding",
  "listFindings",
  "writeNote",
];

export const CHAT_TOOLS: ToolName[] = [
  "getWorkflowState",
  "getRecentActivity",
  "updateBrief",
  "startResearchRun",
  "cancelResearchRun",
  "readRunReport",
  "listFindings",
  ...READ_TOOLS,
];

/** Who's calling a tool: a research run (logs to the timeline) or the chat pane. */
export type ToolContext = {
  workflowId: string;
  userId: string;
  runId: string | null;
  actor: "run" | "chat";
};

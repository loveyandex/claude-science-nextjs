import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { getModel, type ModelId } from "@/lib/ai-provider";
import { prisma } from "@/lib/prisma";
import { extractPageText } from "@/lib/pdf";
import { webSearch } from "@/lib/web-search";
import { runPythonCode } from "@/lib/python-runner";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ARTICLE_SELECT = { title: true, abstract: true, url: true, pdfUrl: true } as const;

// Opt-in: arbitrary code execution is genuinely dangerous. This runs as a
// real subprocess with no sandbox beyond a timeout + output cap (see
// src/lib/python-runner.ts) — leave this off in any shared/deployed
// environment until a real sandbox (container, gVisor, etc.) sits in
// front of it.
const PYTHON_TOOL_ENABLED = process.env.ENABLE_PYTHON_TOOL === "true";

const SYSTEM_PROMPT = `You are locaul science, a research assistant with access to a local \
library of indexed papers (real PDFs whose first page has been read and summarized into title + \
abstract records) plus some general-purpose tools.

Local library tools:
- searchArticles: keyword search across title/abstract. Only use a query when the person actually \
gave you something to search for.
- listRecentArticles: no keyword needed — most recently indexed papers. Use for "what's in the \
library" / broad discovery instead of forcing a keyword search.
- getLibraryStats: no arguments — indexed/failed counts and most recent indexing activity.
- getArticleByUrl: fetch one article's full record by its url (e.g. after a search hit).
- readArticlePage: read one specific page of an article's original PDF by url + page number, for \
when the abstract alone isn't enough and the person wants a specific page's content (e.g. "read \
page 2 of that paper").

General tools:
- webSearch: real web search (not the local library) for anything outside the indexed papers.
- runPythonCode${PYTHON_TOOL_ENABLED ? "" : " (currently disabled by the operator)"}: run a short \
Python snippet and get back its stdout/stderr — e.g. to compute something from numbers you found \
in a paper, or verify a calculation. Not for anything long-running or file/network access.

Always call tools using the actual tool-calling mechanism your API exposes — never write tool \
call JSON out as plain text in your reply, and never invent a tool name that isn't listed above. \
When a task needs multiple steps (read something, then search, then compute, then answer), work \
through them one tool call at a time rather than trying to do everything in one call.

If a search comes back empty, try a different, more general query once before concluding nothing \
is indexed on the topic — don't call the same tool with the same or an empty query repeatedly. \
When you use results from a paper, mention its title naturally in your answer so the person knows \
where the claim came from. If nothing relevant is found anywhere, say so plainly rather than \
making something up.`;

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json();
  const { messages, model: modelId, thinking, chatId }: {
    messages: UIMessage[];
    model?: ModelId;
    thinking?: boolean;
    chatId: string;
  } = body;

  if (!chatId) {
    return Response.json({ error: "chatId is required." }, { status: 400 });
  }

  // Ownership check — a chatId that exists but belongs to someone else
  // should look identical to one that doesn't exist at all.
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { userId: true } });
  if (!chat || chat.userId !== auth.sub) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  const modelMessages = await convertToModelMessages(messages);
  const model = getModel(modelId);

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    stopWhen: stepCountIs(8),
    // Best-effort "thinking mode": Gemini supports this natively via
    // thinkingConfig; other providers ignore unknown providerOptions
    // namespaces rather than erroring, so this is safe to always pass.
    providerOptions: thinking
      ? { google: { thinkingConfig: { includeThoughts: true } } }
      : undefined,
    tools: {
      searchArticles: tool({
        description:
          "Search the indexed article library by keyword across title and abstract. Use this only when the person gave an actual topic/keyword to search for.",
        inputSchema: z.object({
          query: z
            .string()
            .min(1)
            .describe("Keywords to search for across paper titles and abstracts."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("Max number of results to return (default 5)."),
        }),
        execute: async ({ query, limit }) => {
          const take = limit ?? 5;
          const results = await prisma.article.findMany({
            where: {
              status: "indexed",
              OR: [{ title: { contains: query } }, { abstract: { contains: query } }],
            },
            take,
            orderBy: { createdAt: "desc" },
            select: ARTICLE_SELECT,
          });
          return { query, count: results.length, results };
        },
      }),

      listRecentArticles: tool({
        description:
          "List the most recently indexed articles, no keyword required. Use for broad 'what's in the library' / 'what's been indexed' questions.",
        inputSchema: z.object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("Max number of articles to return (default 10)."),
        }),
        execute: async ({ limit }) => {
          const take = limit ?? 10;
          const results = await prisma.article.findMany({
            where: { status: "indexed" },
            take,
            orderBy: { createdAt: "desc" },
            select: ARTICLE_SELECT,
          });
          return { count: results.length, results };
        },
      }),

      getLibraryStats: tool({
        description:
          "Get counts of how many articles are indexed vs failed in the local library, and when the most recent one was added. No arguments.",
        inputSchema: z.object({}),
        execute: async () => {
          const [total, failed, latest] = await Promise.all([
            prisma.article.count({ where: { status: "indexed" } }),
            prisma.article.count({ where: { status: "failed" } }),
            prisma.article.findFirst({
              where: { status: "indexed" },
              orderBy: { createdAt: "desc" },
              select: { title: true, createdAt: true },
            }),
          ]);
          return {
            total,
            failed,
            mostRecent: latest
              ? { title: latest.title, indexedAt: latest.createdAt.toISOString() }
              : null,
          };
        },
      }),

      getArticleByUrl: tool({
        description:
          "Fetch one specific article's full record (title, abstract, PDF URL) by its url, e.g. after finding it via search.",
        inputSchema: z.object({
          url: z.string().min(1).describe("The article's url field, as returned by search."),
        }),
        execute: async ({ url }) => {
          const article = await prisma.article.findUnique({
            where: { url },
            select: ARTICLE_SELECT,
          });
          return article ?? { error: `No indexed article found for url "${url}".` };
        },
      }),

      readArticlePage: tool({
        description:
          "Read one specific page of an article's original PDF by url + page number (1-indexed). Page 1 is served from the cached abstract-extraction data; other pages are fetched and read from the live PDF on demand.",
        inputSchema: z.object({
          url: z.string().min(1).describe("The article's url field."),
          page: z.number().int().min(1).describe("1-indexed page number to read."),
        }),
        execute: async ({ url, page }) => {
          const article = await prisma.article.findUnique({
            where: { url },
            select: { pdfUrl: true, firstPage: true, pageCount: true, title: true },
          });
          if (!article) return { error: `No indexed article found for url "${url}".` };

          if (page === 1 && article.firstPage) {
            return { title: article.title, page: 1, pageCount: article.pageCount, text: article.firstPage };
          }

          try {
            const res = await fetch(article.pdfUrl);
            if (!res.ok) {
              return { error: `Fetching the PDF failed: ${res.status} ${res.statusText}` };
            }
            const bytes = await res.arrayBuffer();
            const extraction = await extractPageText(bytes, page);
            if (!extraction.ok) return { error: extraction.error };
            return {
              title: article.title,
              page,
              pageCount: extraction.pageCount,
              text: extraction.pageText,
            };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Failed to read that page." };
          }
        },
      }),

      webSearch: tool({
        description:
          "Search the public web (not the local paper library) for general information, current events, or anything outside what's indexed locally.",
        inputSchema: z.object({
          query: z.string().min(1).describe("The search query."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("Max number of results (default 5)."),
        }),
        execute: async ({ query, limit }) => {
          try {
            const results = await webSearch(query, limit ?? 5);
            return { query, count: results.length, results };
          } catch (err) {
            return {
              error: err instanceof Error ? err.message : "Web search failed.",
              query,
              count: 0,
              results: [],
            };
          }
        },
      }),

      ...(PYTHON_TOOL_ENABLED
        ? {
            runPythonCode: tool({
              description:
                "Run a short Python 3 snippet and return its stdout/stderr. 10-second timeout, output capped at 8000 characters. No filesystem or network access should be relied upon.",
              inputSchema: z.object({
                code: z.string().min(1).describe("The Python source code to run."),
              }),
              execute: async ({ code }) => {
                try {
                  return await runPythonCode(code);
                } catch (err) {
                  return {
                    error: err instanceof Error ? err.message : "Failed to run Python code.",
                  };
                }
              },
            }),
          }
        : {}),
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onEnd: async ({ messages: updatedMessages }) => {
      // Additive persistence, not a change to the model/tool logic above:
      // save the full conversation (parts and all — reasoning, tool
      // calls, text) so a page reload can replay the same timeline.
      const firstUserText = extractFirstUserText(updatedMessages);
      await prisma.chat.update({
        where: { id: chatId },
        data: {
          // Prisma's generated Json input type isn't visible in this sandbox
          // (client isn't generated here — see README); UIMessage[] is
          // plain JSON-serializable data, so this cast should resolve
          // cleanly against the real generated types. Worth a quick check
          // once you run `prisma generate` locally.
          messages: updatedMessages as unknown as object,
          model: modelId ?? undefined,
          thinking: thinking ?? undefined,
          // First user message never changes turn-to-turn, so recomputing
          // this every save is idempotent, not title drift.
          ...(firstUserText ? { title: firstUserText.slice(0, 80) } : {}),
        },
      });
    },
  });
}

/** Pulls the text of the first user message, used to derive the chat's title. */
function extractFirstUserText(messages: UIMessage[]): string | null {
  const first = messages.find((m) => m.role === "user");
  if (!first) return null;
  const textPart = first.parts?.find((p): p is { type: "text"; text: string } => p.type === "text");
  return textPart?.text?.trim() || null;
}

export async function GET() {
  const { MODEL_OPTIONS } = await import("@/lib/ai-provider");
  return Response.json({ models: MODEL_OPTIONS, pythonToolEnabled: PYTHON_TOOL_ENABLED });
}

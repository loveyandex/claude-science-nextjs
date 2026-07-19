import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { model, MODEL_NAME } from "@/lib/ai-provider";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ARTICLE_SELECT = { title: true, abstract: true, url: true, pdfUrl: true } as const;

const SYSTEM_PROMPT = `You are locaul science, a research assistant with access to a library of \
indexed papers (real PDFs whose first page has been read and summarized into title + abstract \
records, saved locally — not the live repo).

You have four tools over that local library:
- searchArticles: keyword search across title/abstract. Only use a query when the person actually \
gave you something to search for.
- listRecentArticles: no keyword needed — returns the most recently indexed papers. Use this for \
"what's in the library", "what's been indexed", "any papers on X" (broad discovery) type asks \
instead of forcing a keyword search.
- getLibraryStats: no arguments — returns how many articles are indexed/failed and the most \
recent indexing activity. Use this for "how many papers do you have" type questions.
- getArticleByUrl: fetch one specific article's full record when you already know its url (e.g. \
after a search result) and need its complete abstract.

Always call tools using the actual tool-calling mechanism your API exposes — never write tool \
call JSON out as plain text in your reply, and never invent a tool name that isn't listed above.

If a search comes back empty, try a different, more general query once before concluding nothing \
is indexed on the topic — don't call the same tool with the same or an empty query repeatedly. \
When you use results from a paper, mention its title naturally in your answer so the person knows \
where the claim came from. If the library has nothing relevant, say so plainly rather than making \
something up.`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    stopWhen: stepCountIs(5),
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
    },
  });

  return result.toUIMessageStreamResponse();
}

export async function GET() {
  return Response.json({ model: MODEL_NAME, ok: true });
}

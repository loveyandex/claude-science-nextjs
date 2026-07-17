import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { model, MODEL_NAME } from "@/lib/ai-provider";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Claude Science, a research assistant with access to a library of \
indexed papers (real PDFs that have been read and summarized into title + abstract records).

Use the searchArticles tool whenever the user asks about specific findings, mechanisms, methods, \
or anything that indexed papers might cover — don't answer from general knowledge alone if the \
library might have something directly relevant. Call it with a few different keyword phrasings if \
the first search comes back empty before concluding nothing is indexed on the topic.

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
          "Search the indexed article library by keyword. Returns matching papers' title, abstract, and PDF URL. Use this to ground answers in real indexed papers instead of guessing.",
        inputSchema: z.object({
          query: z
            .string()
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
            select: { title: true, abstract: true, url: true, pdfUrl: true },
          });
          return {
            query,
            count: results.length,
            results,
          };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}

export async function GET() {
  return Response.json({ model: MODEL_NAME, ok: true });
}

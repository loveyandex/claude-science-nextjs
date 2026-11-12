// Pure helpers that reshape the prompt before each model call; safe to run
// in the workflow sandbox.

type PromptMessage = { role: string; content: unknown };

type Part = { type?: string; toolCallId?: string };

/**
 * Removes tool calls that never got a result. A step whose provider stream
 * broke off mid-way still records its tool calls, unexecuted; resuming from
 * that history fails ("Tool results are missing"), so the model is left to
 * make those calls again instead.
 */
export function dropUnansweredToolCalls<T extends PromptMessage[]>(messages: T): T {
  const answered = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as Part[]) {
      if (part?.type === "tool-result" && part.toolCallId) answered.add(part.toolCallId);
    }
  }
  return messages.flatMap((m) => {
    if (m.role !== "assistant" || !Array.isArray(m.content)) return [m];
    const content = (m.content as Part[]).filter(
      (part) => part?.type !== "tool-call" || (part.toolCallId != null && answered.has(part.toolCallId))
    );
    if (content.length === m.content.length) return [m];
    return content.length > 0 ? [{ ...m, content }] : [];
  }) as unknown as T;
}

/**
 * Drops earlier reasoning from assistant turns. OpenAI-compatible providers
 * get it sent back as `reasoning_content`, which some (Groq) reject outright.
 * Gemini keeps it: its reasoning parts can carry the thought signatures its
 * tool calling depends on.
 */
export function stripReasoningFor<T extends PromptMessage[]>(providerType: string, messages: T): T {
  if (providerType === "google") return messages;
  return messages.map((m) =>
    m.role === "assistant" && Array.isArray(m.content)
      ? { ...m, content: m.content.filter((part: { type?: string }) => part?.type !== "reasoning") }
      : m
  ) as T;
}

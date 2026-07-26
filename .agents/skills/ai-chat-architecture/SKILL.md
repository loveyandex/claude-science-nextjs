# AI Chat Architecture — locaul science

Read this before touching `src/app/api/chat/route.ts`, `src/lib/ai-provider.ts`,
`src/components/assistant-ui/*`, or before adding a new tool.

## Model switching: one route, two providers

`src/lib/ai-provider.ts` exports `getModel(id: string | undefined | null): LanguageModel`, which
switches between two AI SDK providers based on a plain string id sent from the client:

- `"gpt-oss"` → `@ai-sdk/openai-compatible`, pointed at `OPENAI_BASE_URL`/`MODEL_NAME` — works
  with OpenAI itself, Groq, a local vLLM/Ollama server, whatever's OpenAI-compatible.
- `"gemini-flash-lite"` → `@ai-sdk/google`, using `GOOGLE_GENERATIVE_AI_API_KEY`/`GEMINI_MODEL_NAME`.

`MODEL_OPTIONS` (also exported) is the list the `/api/chat` `GET` handler returns, which
`model-picker.tsx`'s combobox renders — add a new provider by adding an entry there and a branch
in `getModel()`, not by hardcoding a model anywhere else.

Separately, `export const model = openaiCompatible(modelName)` (lowercase, no `getModel` call) is
a **fixed** model used only by `/api/articles/index`'s extraction step (title/abstract from a
PDF's first page) — that pipeline was never meant to be user-selectable, so don't wire the
picker's `model` into it.

**"Thinking mode"** (the toggle next to the model picker) is passed through as
`providerOptions.google.thinkingConfig.includeThoughts` — **Gemini-only**, deliberately. gpt-oss
reasoning-effort control isn't standardized the way Gemini's is across arbitrary
OpenAI-compatible endpoints, so this was left unwired for that provider rather than guessing at a
param shape that might not match your specific backend.

## The model/chatId "who owns what" split

`src/components/assistant-ui/model-context.tsx`'s `ModelProvider` owns *only* model + thinking
state, plus a stable `getRequestBody()` (ref-backed, so switching models mid-session doesn't
recreate the transport and drop in-flight state). It knows nothing about `chatId`.

`chatId` is layered on top at the page level (`chat-session.tsx`, `new-chat-redirect.tsx`) — each
page's transport does `body: () => ({ ...getRequestBody(), chatId })`. If you add a third thing
the server needs on every request, it goes in at that same layer, not inside `ModelProvider`.

## Tools (all defined inline in `api/chat/route.ts`, all operating on the local `Article` table)

`searchArticles`, `listRecentArticles`, `getLibraryStats`, `getArticleByUrl`, `readArticlePage`,
`webSearch`, and (conditionally, behind `ENABLE_PYTHON_TOOL`) `runPythonCode`. Two things to know
before adding an eighth:

1. **The UI has a matching entry per tool, and it's not automatic.**
   `src/components/assistant-ui/tool-call.tsx`'s `TOOL_META` map needs an icon + label function
   for the new tool name, or it silently falls back to a generic icon and the raw tool name as
   the label — functional, but visually inconsistent with the rest. `summarizeResult()` and
   `ResultView()` in the same file need a branch too if the result shape doesn't fit the generic
   `{ count, results }` / `{ total }` fallbacks already handled there (see how `webSearch`,
   `readArticlePage`, and `runPythonCode` each got a bespoke result renderer — link results,
   stdout/stderr blocks, page-text snippets respectively).
2. **`stopWhen: stepCountIs(5)`** caps the model at 5 sequential steps (tool call → tool call →
   ... → final text) per turn. A tool-heavy task (search, then read, then run code, then
   conclude) can legitimately hit this — raise it if turns are getting cut off mid-task, but
   remember every step is a full model round-trip, so this is also your basic cost/latency
   control.

## The agent-activity timeline (`step-flow.tsx`)

This is the "thinking + tool calls, smaller and visually distinct from the response text" UI.
It's built on assistant-ui's own documented `groupPartByType` + `MessagePrimitive.GroupedParts`
API (verified against `@assistant-ui/core`'s source — this is the *real*, current recommended
pattern for this, not a custom reimplementation, and not the older deprecated
`Unstable_PartsGrouped`). `GroupedParts` coalesces adjacent reasoning/tool-call parts into one
group, which `step-flow.tsx` renders as a compact "working" rail (`Brain` icon, muted italic
reasoning lines, ghost tool-call rows from `tool-call.tsx`) — visually separate from the actual
response text, which renders at full size once the group ends.

The "waiting for the first token" dots (`thinking-indicator.tsx`) are wired in via
`GroupedParts`'s built-in `indicator` slot (default `"no-text"` — fires while there are no parts
yet, or the last part isn't text/reasoning), not a manually-tracked loading state. If a future
change to `step-flow.tsx` stops rendering the indicator, check whether an explicit `indicator`
prop got added to `<MessagePrimitive.GroupedParts>` that overrides that default, before assuming
the indicator component itself broke.

`src/components/assistant-ui/thread.tsx` (`/chat`) and `thread-assist-ui.tsx`
(`/chat-assist-ui`) both use the exact same `StepFlowParts`, `MarkdownText`
(`markdown-text.tsx` — this is also where the claude.ai-matched 1rem/400-weight/1.5-line-height
typography spec lives, deliberately centralized so the two pages can't drift out of sync on this
again), and `ToolFallback`. If you're fixing something in one and it's not page-specific
UI chrome, it almost certainly belongs in the shared component, not duplicated into both files.

## Persistence hook

`api/chat/route.ts`'s only persistence-related code is the `onEnd` callback passed to
`toUIMessageStreamResponse({ originalMessages: messages, onEnd })` — this is additive, sitting
around the existing `streamText` call; the system prompt, tools, and model logic are untouched by
it. See the Backend Architecture skill file for what `onEnd` actually does
(`ensureMessageIds` + save) and why.

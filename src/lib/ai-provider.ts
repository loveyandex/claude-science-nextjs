import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.MODEL_NAME || "gpt-4o-mini";

if (!apiKey) {
  // Not throwing here — we want the app (and especially /make-science's
  // pending-list view) to still render without a key configured yet.
  // The actual LLM calls will fail loudly with a clear message instead.
  console.warn(
    "[ai-provider] OPENAI_API_KEY is not set — LLM calls will fail until it's configured in .env"
  );
}

const provider = createOpenAICompatible({
  name: "local-science-llm",
  baseURL,
  apiKey,
});

/** The single chat-capable model used across the app (chat + extraction). */
export const model = provider(modelName);

export const MODEL_NAME = modelName;

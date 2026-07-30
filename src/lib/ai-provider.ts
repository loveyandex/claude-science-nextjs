import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.MODEL_NAME || "gpt-oss-120b";

if (!apiKey) {
  // Not throwing here — we want the app (and especially /make-science's
  // pending-list view) to still render without a key configured yet.
  // The actual LLM calls will fail loudly with a clear message instead.
  console.warn(
    "[ai-provider] OPENAI_API_KEY is not set — LLM calls will fail until it's configured in .env"
  );
}

const openaiCompatible = createOpenAICompatible({
  name: "locaul-science-llm",
  baseURL,
  apiKey,
});

const google = createGoogleGenerativeAI({
  // Reads GOOGLE_GENERATIVE_AI_API_KEY from env if apiKey isn't passed
  // explicitly, but we're explicit here so a missing key fails the same
  // clear way as the OpenAI-compatible provider does above.
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.warn(
    "[ai-provider] GOOGLE_GENERATIVE_AI_API_KEY is not set — the Gemini model option will fail until it's configured in .env"
  );
}

const geminiModelName = process.env.GEMINI_MODEL_NAME || "gemini-3.1-flash-lite";

/**
 * Model registry shared by /api/chat and both chat pages' model picker.
 * `id` is what the client sends in the request body to pick a provider —
 * keep these ids stable since they're also used as React state/localStorage
 * keys on the client.
 */
export const MODEL_OPTIONS = [
  {
    id: "gpt-oss",
    label: modelName,
    description: "Your OPENAI_BASE_URL endpoint (OpenAI-compatible)",
  },
  {
    id: "gemini-flash-lite",
    label: geminiModelName,
    description: "Google Generative AI",
  },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

/** Resolve a client-selected model id to an actual AI SDK LanguageModel. */
export function getModel(id: string | undefined | null): LanguageModel {
  if (id === "gemini-flash-lite") {
    return google(geminiModelName);
  }
  // Default / "gpt-oss" / anything unrecognized falls back to the
  // configured OpenAI-compatible endpoint rather than erroring, so an
  // unfamiliar or stale model id from an older client tab doesn't hard-fail.
  return openaiCompatible(modelName);
}

/**
 * Gemini 3.x models expose reasoning depth via thinkingConfig.thinkingLevel
 * (MINIMAL/LOW/MEDIUM/HIGH) instead of the thinkingBudget token count used
 * by 2.x models — the two aren't interchangeable, so callers need to know
 * which family the selected model id resolves to.
 */
export function isGemini3(id: string | undefined | null): boolean {
  return id === "gemini-flash-lite" && geminiModelName.startsWith("gemini-3");
}

/** The default chat-capable model — used by /make-science's extraction step, which doesn't offer a picker. */
export const model = openaiCompatible(modelName);

export const MODEL_NAME = modelName;

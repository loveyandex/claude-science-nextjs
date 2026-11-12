import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";

/**
 * Plain-data description of an AiProvider + model, as loaded by
 * loadModelConfig() in a step. The workflow body can't touch Prisma, so it
 * gets this and builds the model itself.
 */
export type ModelConfig = {
  wireId: string;
  type: string;
  providerLabel: string;
  baseUrl: string | null;
  apiKey: string | null;
  modelName: string;
  label: string;
};

/** Same provider switch as src/lib/ai-provider.ts's buildClientModel. */
export function buildClientModel(cfg: ModelConfig): LanguageModelV4 {
  if (cfg.type === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: cfg.apiKey ?? undefined,
      baseURL: cfg.baseUrl || undefined,
    });
    return google(cfg.modelName);
  }
  const openaiCompatible = createOpenAICompatible({
    name: cfg.providerLabel,
    baseURL: cfg.baseUrl || "https://api.openai.com/v1",
    apiKey: cfg.apiKey ?? undefined,
  });
  return openaiCompatible(cfg.modelName);
}

/**
 * A provider model that crosses workflow step boundaries as its plain
 * ModelConfig. WorkflowAgent hands the model to every durable model-call
 * step; the provider SDKs' own models serialize their config, but closures
 * in it (openai-compatible's `url` builder) don't survive, so this wrapper
 * serializes the config and rebuilds the real client on the other side.
 */
export class ConfiguredModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  private client: LanguageModelV4 | null = null;

  constructor(readonly config: ModelConfig) {}

  static [WORKFLOW_SERIALIZE](model: ConfiguredModel) {
    return model.config;
  }

  static [WORKFLOW_DESERIALIZE](config: ModelConfig) {
    return new ConfiguredModel(config);
  }

  private get inner(): LanguageModelV4 {
    return (this.client ??= buildClientModel(this.config));
  }

  get provider() {
    return this.inner.provider;
  }

  get modelId() {
    return this.config.modelName;
  }

  get supportedUrls() {
    return this.inner.supportedUrls;
  }

  doGenerate(options: LanguageModelV4CallOptions) {
    return this.inner.doGenerate(options);
  }

  doStream(options: LanguageModelV4CallOptions) {
    return this.inner.doStream(options);
  }
}

export function buildModel(cfg: ModelConfig): LanguageModelV4 {
  return new ConfiguredModel(cfg);
}

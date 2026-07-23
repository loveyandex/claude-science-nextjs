"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Static fallback in case /api/chat's GET (which reflects the real
 * MODEL_OPTIONS from src/lib/ai-provider.ts) hasn't resolved yet. Ids
 * must match ai-provider.ts's MODEL_OPTIONS ids exactly.
 */
const FALLBACK_MODELS = [
  { id: "gpt-oss", label: "gpt-oss-120b", description: "Your OpenAI-compatible endpoint" },
  { id: "gemini-flash-lite", label: "Gemini 3.1 Flash-Lite", description: "Google Generative AI" },
];

type ModelOption = { id: string; label: string; description: string };

type ModelContextValue = {
  models: ModelOption[];
  model: string;
  setModel: (id: string) => void;
  thinking: boolean;
  setThinking: (v: boolean) => void;
  /**
   * Stable across renders — reads the *current* model/thinking selection
   * at call time via a ref, so `DefaultChatTransport({ body: getRequestBody })`
   * can stay a single long-lived transport instance instead of being
   * rebuilt (and losing in-flight state) every time the picker changes.
   */
  getRequestBody: () => { model: string; thinking: boolean };
};

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({
  children,
  initialModel,
  initialThinking,
}: {
  children: ReactNode;
  /** Seed from a persisted chat's saved model/thinking when resuming one. */
  initialModel?: string;
  initialThinking?: boolean;
}) {
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [model, setModel] = useState<string>(initialModel || FALLBACK_MODELS[0].id);
  const [thinking, setThinking] = useState(initialThinking ?? false);

  const latest = useRef({ model, thinking });
  useEffect(() => {
    latest.current = { model, thinking };
  }, [model, thinking]);

  useEffect(() => {
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.models) && d.models.length > 0) setModels(d.models);
      })
      .catch(() => {
        /* keep fallback list */
      });
  }, []);

  const getRequestBody = useRef(() => latest.current).current;

  return (
    <ModelContext.Provider
      value={{ models, model, setModel, thinking, setThinking, getRequestBody }}
    >
      {children}
    </ModelContext.Provider>
  );
}

export function useModelSelection() {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error("useModelSelection must be used within a ModelProvider");
  return ctx;
}

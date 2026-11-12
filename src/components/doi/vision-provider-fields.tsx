"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type VisionProvider = {
  id: string;
  type: "openai-compatible" | "google";
  label: string;
  baseUrl: string | null;
  models: { modelName: string; label: string }[];
};

// Shared by the single-article "Make science" panel and Springer step 4,
// so a provider/model picked in one carries over to the other.
const PROVIDER_KEY = "doi:makeScience:provider";
const MODEL_KEY = "doi:makeScience:model";

function defaultModelFor(p: VisionProvider | undefined): string {
  if (!p) return "";
  const pick = (re: RegExp) => p.models.find((m) => re.test(m.modelName))?.modelName;
  return pick(/gemma/i) ?? (p.type === "google" ? pick(/flash/i) : undefined) ?? p.models[0]?.modelName ?? "";
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** Providers that can transcribe page images, plus the remembered provider/model pick. */
export function useVisionProviders() {
  const { authFetch } = useAuth();
  const [providers, setProviders] = useState<VisionProvider[] | null>(null);
  const [providerId, setProviderId] = useState("");
  const [modelName, setModelName] = useState("");

  useEffect(() => {
    authFetch("/api/doi-articles/vision-providers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const list: VisionProvider[] = data.providers ?? [];
        setProviders(list);
        let storedProvider = "";
        let storedModel = "";
        try {
          storedProvider = localStorage.getItem(PROVIDER_KEY) ?? "";
          storedModel = localStorage.getItem(MODEL_KEY) ?? "";
        } catch {}
        const provider = list.find((p) => p.id === storedProvider) ?? list[0];
        if (!provider) return;
        setProviderId(provider.id);
        setModelName(storedModel && provider.id === storedProvider ? storedModel : defaultModelFor(provider));
      })
      .catch(() => setProviders([]));
  }, [authFetch]);

  const selectProvider = (id: string) => {
    setProviderId(id);
    remember(PROVIDER_KEY, id);
    const model = defaultModelFor(providers?.find((p) => p.id === id));
    setModelName(model);
    remember(MODEL_KEY, model);
  };

  const selectModel = (model: string) => {
    setModelName(model);
    remember(MODEL_KEY, model);
  };

  return {
    providers,
    provider: providers?.find((p) => p.id === providerId),
    providerId,
    modelName,
    selectProvider,
    selectModel,
  };
}

/** Provider dropdown + model field (free text, with the provider's models suggested). */
export function VisionProviderFields({
  vision,
  disabled,
  idPrefix,
}: {
  vision: ReturnType<typeof useVisionProviders>;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { providers, provider, providerId, modelName, selectProvider, selectModel } = vision;
  return (
    <>
      <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        provider
        <Select value={providerId} disabled={disabled || !providers} onValueChange={selectProvider}>
          <SelectTrigger className="border border-border text-foreground min-w-[140px] justify-between">
            <SelectValue placeholder="loading…" />
          </SelectTrigger>
          <SelectContent>
            {providers?.map((p) => (
              <SelectItem
                key={p.id}
                value={p.id}
                description={`${p.type === "google" ? "gemini" : "openai-compatible"} · ${
                  p.baseUrl ?? "generativelanguage.googleapis.com"
                }`}
              >
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        model
        <input
          list={`${idPrefix}-models-${providerId}`}
          value={modelName}
          disabled={disabled}
          onChange={(e) => selectModel(e.target.value)}
          placeholder={provider?.type === "google" ? "gemini-2.5-flash" : "gemma4:31b"}
          className="w-44 rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus-visible:border-accent"
        />
        <datalist id={`${idPrefix}-models-${providerId}`}>
          {provider?.models.map((m) => (
            <option key={m.modelName} value={m.modelName}>
              {m.label}
            </option>
          ))}
        </datalist>
      </label>
    </>
  );
}

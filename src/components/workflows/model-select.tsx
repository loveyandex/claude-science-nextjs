"use client";

import { useEffect, useMemo, useState } from "react";
import { Server, Cpu } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-context";
import type { ProviderOption } from "@/components/workflows/types";

/**
 * Two-level picker: an AI provider from Settings → AI Providers, then one of
 * that provider's enabled models. The value is the model's wireId, which is
 * what the workflow stores and the agents resolve (custom base URL included).
 */
export function ModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (wireId: string) => void;
  disabled?: boolean;
}) {
  const { authFetch } = useAuth();
  const [providers, setProviders] = useState<ProviderOption[] | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/workflows/models")
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
  }, [authFetch]);

  const selectedProvider = useMemo(() => {
    if (!providers) return null;
    return (
      providers.find((p) => p.id === providerId) ??
      providers.find((p) => p.models.some((m) => m.wireId === value)) ??
      providers[0] ??
      null
    );
  }, [providers, providerId, value]);

  const modelInProvider = value && selectedProvider?.models.some((m) => m.wireId === value) ? value : undefined;

  if (providers && providers.length === 0) {
    return <span className="font-mono text-[11px] text-destructive">no AI provider configured — add one in Settings</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Select
        value={selectedProvider?.id}
        disabled={disabled || !providers}
        onValueChange={(id) => {
          setProviderId(id);
          const first = providers?.find((p) => p.id === id)?.models[0];
          if (first) onChange(first.wireId);
        }}
      >
        <SelectTrigger className="border border-border/70 bg-background" title="AI provider">
          <Server size={11} className="opacity-70" />
          <SelectValue placeholder="provider" />
        </SelectTrigger>
        <SelectContent>
          {providers?.map((p) => (
            <SelectItem key={p.id} value={p.id} description={`${p.type}${p.baseUrl ? ` · ${p.baseUrl}` : ""}`}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={modelInProvider} disabled={disabled || !selectedProvider} onValueChange={onChange}>
        <SelectTrigger className="border border-border/70 bg-background" title="Model">
          <Cpu size={11} className="opacity-70" />
          <SelectValue placeholder="pick a model" />
        </SelectTrigger>
        <SelectContent>
          {selectedProvider?.models.map((m) => (
            <SelectItem key={m.wireId} value={m.wireId} description={m.label !== m.modelName ? m.modelName : undefined}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

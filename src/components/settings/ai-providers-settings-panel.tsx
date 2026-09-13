"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-context";

type ProviderType = "openai-compatible" | "google";

type ModelRow = {
  id: string;
  wireId: string;
  modelName: string;
  label: string | null;
  enabled: boolean;
};

type ProviderRow = {
  id: string;
  type: ProviderType;
  label: string;
  baseUrl: string | null;
  maskedApiKey: string | null;
  hasApiKey: boolean;
  enabled: boolean;
  source: "manual" | "env";
  models: ModelRow[];
};

const PROVIDER_TYPE_LABEL: Record<ProviderType, string> = {
  "openai-compatible": "OpenAI-compatible (Ollama, Groq, vLLM, OpenAI...)",
  google: "Google Gemini",
};

export function AiProvidersSettingsPanel() {
  const { authFetch } = useAuth();
  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [newType, setNewType] = useState<ProviderType>("openai-compatible");
  const [newLabel, setNewLabel] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/settings/ai-providers", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load providers");
      setProviders(json.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addProvider = async () => {
    if (!newLabel.trim()) return;
    if (newType === "openai-compatible" && !newBaseUrl.trim()) {
      setAddError("Base URL is required for an OpenAI-compatible provider.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await authFetch("/api/settings/ai-providers/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          label: newLabel.trim(),
          baseUrl: newBaseUrl.trim() || undefined,
          apiKey: newApiKey.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add provider");
      setNewLabel("");
      setNewBaseUrl("");
      setNewApiKey("");
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add provider");
    } finally {
      setAdding(false);
    }
  };

  const toggleProvider = async (id: string, enabled: boolean) => {
    setProviders((prev) =>
      prev ? prev.map((p) => (p.id === id ? { ...p, enabled } : p)) : prev
    );
    try {
      const res = await authFetch(`/api/settings/ai-providers/providers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update provider");
    } catch {
      await load();
    }
  };

  const deleteProvider = async (id: string) => {
    setProviders((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
    try {
      const res = await authFetch(`/api/settings/ai-providers/providers/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete provider");
    } catch {
      await load();
    }
  };

  if (loading) {
    return <p className="font-mono text-[11px] text-muted-foreground">Loading…</p>;
  }

  if (error || !providers) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]">
        <AlertTriangle size={15} className="text-destructive shrink-0 mt-0.5" />
        <p className="text-destructive">{error ?? "Failed to load providers"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display font-semibold text-[15px] mb-1">AI providers</h2>
        <p className="font-mono text-[11px] text-muted-foreground mb-4">
          Providers and models available in the chat model picker. An "OpenAI-compatible"
          provider works with Ollama, Groq, vLLM, LM Studio, OpenAI itself — anything exposing
          that API shape. If OPENAI_BASE_URL / GOOGLE_GENERATIVE_AI_API_KEY were set in .env,
          they were seeded here automatically as "From .env" the first time this pool was empty.
        </p>

        <div className="space-y-3 mb-4">
          {providers.length === 0 && (
            <p className="font-mono text-[11px] text-muted-foreground">
              No providers yet — add one below.
            </p>
          )}
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              isExpanded={expanded.has(p.id)}
              onToggleExpanded={() => toggleExpanded(p.id)}
              onToggleEnabled={(enabled) => toggleProvider(p.id, enabled)}
              onDelete={() => deleteProvider(p.id)}
              authFetch={authFetch}
              onModelsChanged={load}
            />
          ))}
        </div>

        <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
          <p className="text-[13px] font-medium">Add provider</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={newType} onValueChange={(v) => setNewType(v as ProviderType)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-compatible">
                  {PROVIDER_TYPE_LABEL["openai-compatible"]}
                </SelectItem>
                <SelectItem value="google">{PROVIDER_TYPE_LABEL.google}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="label, e.g. Ollama (local)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-56"
              disabled={adding}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder={
                newType === "openai-compatible"
                  ? "base URL, e.g. http://localhost:11434/v1"
                  : "base URL (optional — defaults to generativelanguage.googleapis.com/v1beta)"
              }
              value={newBaseUrl}
              onChange={(e) => setNewBaseUrl(e.target.value)}
              className="flex-1 min-w-[240px] font-mono"
              disabled={adding}
            />
            <Input
              placeholder="API key (optional for local Ollama)"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              className="flex-1 min-w-[200px] font-mono"
              disabled={adding}
              type="password"
            />
            <Button onClick={addProvider} disabled={adding || !newLabel.trim()}>
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add provider
            </Button>
          </div>
          {addError && <p className="text-[12px] text-destructive">{addError}</p>}
        </div>
      </section>
    </div>
  );
}

function ProviderCard({
  provider,
  isExpanded,
  onToggleExpanded,
  onToggleEnabled,
  onDelete,
  authFetch,
  onModelsChanged,
}: {
  provider: ProviderRow;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  authFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  onModelsChanged: () => void;
}) {
  return (
    <Card className="px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onToggleExpanded}
          className="flex items-center gap-2 min-w-0 text-left flex-1"
        >
          {isExpanded ? (
            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium truncate">{provider.label}</span>
              <Badge>{provider.type}</Badge>
              <Badge variant={provider.source === "env" ? "accent" : "default"}>
                {provider.source}
              </Badge>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground truncate">
              {provider.baseUrl || (provider.type === "google" ? "generativelanguage.googleapis.com" : "")}
              {provider.maskedApiKey ? ` · ${provider.maskedApiKey}` : " · no API key"}
              {" · "}
              {provider.models.length} model{provider.models.length === 1 ? "" : "s"}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <Switch checked={provider.enabled} onCheckedChange={onToggleEnabled} />
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            title="Delete provider"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <ProviderBaseUrl provider={provider} authFetch={authFetch} onChanged={onModelsChanged} />
          <ProviderModels provider={provider} authFetch={authFetch} onChanged={onModelsChanged} />
        </div>
      )}
    </Card>
  );
}

/**
 * Inline-editable base URL — every provider type can have one (Google
 * defaults to generativelanguage.googleapis.com/v1beta when unset, but a
 * user may want to point it at a proxy or Vertex-compatible gateway
 * instead), so this isn't gated to just "openai-compatible".
 */
function ProviderBaseUrl({
  provider,
  authFetch,
  onChanged,
}: {
  provider: ProviderRow;
  authFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(provider.baseUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultPlaceholder =
    provider.type === "google"
      ? "default: generativelanguage.googleapis.com/v1beta"
      : "base URL, e.g. http://localhost:11434/v1";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`/api/settings/ai-providers/providers/${provider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: value.trim() }),
      });
      if (!res.ok) throw new Error("Failed to update base URL");
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update base URL");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-muted-foreground">Base URL:</span>
        <span className="font-mono text-foreground/90">{provider.baseUrl || "default"}</span>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-6 px-2 text-[11px]">
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Input
        placeholder={defaultPlaceholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 min-w-[240px] font-mono"
        disabled={saving}
      />
      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? <Loader2 size={13} className="animate-spin" /> : "Save"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setEditing(false);
          setValue(provider.baseUrl ?? "");
          setError(null);
        }}
        disabled={saving}
      >
        Cancel
      </Button>
      {error && <p className="w-full text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

function ProviderModels({
  provider,
  authFetch,
  onChanged,
}: {
  provider: ProviderRow;
  authFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  onChanged: () => void;
}) {
  const [newModelName, setNewModelName] = useState("");
  const [newModelLabel, setNewModelLabel] = useState("");
  const [addingModel, setAddingModel] = useState(false);
  const [addModelError, setAddModelError] = useState<string | null>(null);

  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ modelName: string; label?: string }[] | null>(
    null
  );

  const addModel = async () => {
    if (!newModelName.trim()) return;
    setAddingModel(true);
    setAddModelError(null);
    try {
      const res = await authFetch(`/api/settings/ai-providers/providers/${provider.id}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelName: newModelName.trim(),
          label: newModelLabel.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add model");
      setNewModelName("");
      setNewModelLabel("");
      onChanged();
    } catch (err) {
      setAddModelError(err instanceof Error ? err.message : "Failed to add model");
    } finally {
      setAddingModel(false);
    }
  };

  const addCandidate = async (candidate: { modelName: string; label?: string }) => {
    try {
      const res = await authFetch(`/api/settings/ai-providers/providers/${provider.id}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelName: candidate.modelName, label: candidate.label }),
      });
      if (!res.ok) return;
      setCandidates((prev) => prev?.filter((c) => c.modelName !== candidate.modelName) ?? null);
      onChanged();
    } catch {
      // best-effort — leave the chip in place so the user can retry
    }
  };

  const discover = async () => {
    setDiscovering(true);
    setDiscoverError(null);
    setCandidates(null);
    try {
      const res = await authFetch(
        `/api/settings/ai-providers/providers/${provider.id}/discover-models`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!json.ok) {
        setDiscoverError(json.error || "Discovery failed.");
        return;
      }
      const existingModelNames = new Set(provider.models.map((m) => m.modelName));
      setCandidates(
        json.candidates.filter(
          (c: { modelName: string }) => !existingModelNames.has(c.modelName)
        )
      );
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  };

  const toggleModel = async (modelId: string, enabled: boolean) => {
    try {
      await authFetch(`/api/settings/ai-providers/providers/${provider.id}/models/${modelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } finally {
      onChanged();
    }
  };

  const deleteModel = async (modelId: string) => {
    try {
      await authFetch(`/api/settings/ai-providers/providers/${provider.id}/models/${modelId}`, {
        method: "DELETE",
      });
    } finally {
      onChanged();
    }
  };

  return (
    <div className="pl-6 space-y-3">
      <div className="space-y-1.5">
        {provider.models.length === 0 && (
          <p className="font-mono text-[11px] text-muted-foreground">No models yet.</p>
        )}
        {provider.models.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-2.5 py-2"
          >
            <div className="min-w-0 flex items-center gap-2">
              <Switch checked={m.enabled} onCheckedChange={(v) => toggleModel(m.id, v)} />
              <div className="min-w-0">
                <span className="text-[12.5px] font-medium truncate">{m.label || m.modelName}</span>
                {m.label && (
                  <p className="font-mono text-[10px] text-muted-foreground truncate">
                    {m.modelName}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteModel(m.id)}
              title="Delete model"
              className="text-muted-foreground hover:text-destructive shrink-0"
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="model name, e.g. llama3.1:8b"
          value={newModelName}
          onChange={(e) => setNewModelName(e.target.value)}
          className="flex-1 min-w-[180px] font-mono"
          disabled={addingModel}
        />
        <Input
          placeholder="label (optional)"
          value={newModelLabel}
          onChange={(e) => setNewModelLabel(e.target.value)}
          className="w-40"
          disabled={addingModel}
        />
        <Button size="sm" onClick={addModel} disabled={addingModel || !newModelName.trim()}>
          {addingModel ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Add model
        </Button>
      </div>
      {addModelError && <p className="text-[12px] text-destructive">{addModelError}</p>}

      <div className="space-y-2">
        <Button variant="ghost" size="sm" onClick={discover} disabled={discovering}>
          {discovering ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          Load models from provider
        </Button>
        {discoverError && <p className="text-[12px] text-destructive">{discoverError}</p>}
        {candidates && candidates.length === 0 && !discoverError && (
          <p className="font-mono text-[11px] text-muted-foreground">
            No new models found (or all already added).
          </p>
        )}
        {candidates && candidates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((c) => (
              <button
                key={c.modelName}
                onClick={() => addCandidate(c)}
                className="flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:border-accent hover:text-accent transition-colors"
                title="Click to add this model"
              >
                <Plus size={11} />
                {c.label || c.modelName}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

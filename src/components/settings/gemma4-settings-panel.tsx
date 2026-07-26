"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-context";

type KeyRow = {
  id: string;
  label: string | null;
  maskedKey: string;
  source: "manual" | "env";
  enabled: boolean;
  createdAt: string;
};

type ConcurrencyMode = "pages_per_pdf" | "pdfs_per_key";

type Gemma4Settings = {
  keys: KeyRow[];
  concurrencyMode: ConcurrencyMode;
};

export function Gemma4SettingsPanel() {
  const { authFetch } = useAuth();
  const [data, setData] = useState<Gemma4Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/settings/gemma4", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load settings");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addKey = async () => {
    if (!newKey.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await authFetch("/api/settings/gemma4/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() || undefined, key: newKey.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add key");
      setNewLabel("");
      setNewKey("");
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add key");
    } finally {
      setAdding(false);
    }
  };

  const toggleKey = async (id: string, enabled: boolean) => {
    setData((prev) => (prev ? { ...prev, keys: prev.keys.map((k) => (k.id === id ? { ...k, enabled } : k)) } : prev));
    try {
      const res = await authFetch(`/api/settings/gemma4/keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update key");
    } catch {
      await load(); // revert to server truth on failure
    }
  };

  const deleteKey = async (id: string) => {
    setData((prev) => (prev ? { ...prev, keys: prev.keys.filter((k) => k.id !== id) } : prev));
    try {
      const res = await authFetch(`/api/settings/gemma4/keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete key");
    } catch {
      await load();
    }
  };

  const setMode = async (mode: ConcurrencyMode) => {
    setData((prev) => (prev ? { ...prev, concurrencyMode: mode } : prev));
    try {
      const res = await authFetch("/api/settings/gemma4/concurrency-mode", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error("Failed to update concurrency mode");
    } catch {
      await load();
    }
  };

  if (loading) {
    return <p className="font-mono text-[11px] text-muted-foreground">Loading…</p>;
  }

  if (error || !data) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]">
        <AlertTriangle size={15} className="text-destructive shrink-0 mt-0.5" />
        <p className="text-destructive">{error ?? "Failed to load settings"}</p>
      </div>
    );
  }

  const enabledCount = data.keys.filter((k) => k.enabled).length;

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={15} className="text-accent" />
          <h2 className="font-display font-semibold text-[15px]">API keys for gemma4</h2>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-4">
          Cerebras API keys used by make-science-gemma4. Managed here, in Postgres — the backend
          service never stores a key itself, it's only ever handed one per indexing call. If
          CEREBRAS_API_KEY was set in .env, it was added automatically as "From .env" the first
          time this pool was empty.
        </p>

        <div className="space-y-2 mb-4">
          {data.keys.length === 0 && (
            <p className="font-mono text-[11px] text-muted-foreground">No keys yet — add one below.</p>
          )}
          {data.keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0 flex items-center gap-2">
                <Switch checked={k.enabled} onCheckedChange={(v) => toggleKey(k.id, v)} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium truncate">{k.label || "Unlabeled key"}</span>
                    <Badge variant={k.source === "env" ? "accent" : "default"}>{k.source}</Badge>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">{k.maskedKey}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteKey(k.id)}
                title="Delete key"
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-40"
            disabled={adding}
          />
          <Input
            placeholder="csk-..."
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="flex-1 min-w-[240px] font-mono"
            disabled={adding}
            type="password"
          />
          <Button onClick={addKey} disabled={adding || !newKey.trim()}>
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add key
          </Button>
        </div>
        {addError && <p className="text-[12px] text-destructive mt-2">{addError}</p>}

        <p className="font-mono text-[10px] text-muted-foreground mt-3">
          {enabledCount} of {data.keys.length} key{data.keys.length === 1 ? "" : "s"} enabled.
        </p>
      </section>

      <section>
        <h2 className="font-display font-semibold text-[15px] mb-1">Indexing concurrency</h2>
        <p className="font-mono text-[11px] text-muted-foreground mb-4">
          How the enabled keys above are used when running a gemma4 indexing batch.
        </p>

        <div className="space-y-2">
          <ModeOption
            active={data.concurrencyMode === "pages_per_pdf"}
            onClick={() => setMode("pages_per_pdf")}
            title="All keys on one PDF (default)"
            description="Every enabled key works on one PDF's pages at once, round-robinned across them. Once that PDF is fully transcribed, the next one starts."
          />
          <ModeOption
            active={data.concurrencyMode === "pdfs_per_key"}
            onClick={() => setMode("pdfs_per_key")}
            title="One key per PDF, N PDFs at once"
            description="Up to N different PDFs are indexed at the same time (N = enabled key count), each one assigned exactly one key and processed page-by-page sequentially."
          />
        </div>
      </section>
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3.5 py-3 transition-colors ${
        active ? "border-accent bg-accent/5" : "border-border bg-card hover:bg-foreground/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`size-3.5 rounded-full border shrink-0 flex items-center justify-center ${
            active ? "border-accent" : "border-border"
          }`}
        >
          {active && <span className="size-1.5 rounded-full bg-accent" />}
        </span>
        <span className="text-[13.5px] font-medium">{title}</span>
      </div>
      <p className="font-mono text-[11px] text-muted-foreground mt-1 ml-[22px]">{description}</p>
    </button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-context";
import { ModelSelect } from "@/components/workflows/model-select";

export function CreateWorkflowDialog({ trigger }: { trigger: React.ReactNode }) {
  const router = useRouter();
  const { authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [modelWireId, setModelWireId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), modelWireId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create the workflow.");
      router.push(`/workflow/${data.workflow.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the workflow.");
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setBusy(false);
        }
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[18%] z-50 w-[min(92vw,460px)] -translate-x-1/2 rounded-2xl border border-border/70 bg-card p-5 shadow-lg animate-slide-up focus:outline-none">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-md bg-accent/10 text-accent">
                <Workflow size={16} />
              </div>
              <div>
                <Dialog.Title className="font-display text-[15px] font-semibold">New workflow agent</Dialog.Title>
                <Dialog.Description className="font-mono text-[11px] text-muted-foreground">
                  name it now — you&apos;ll shape the brief by chatting with it
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
              <X size={16} />
            </Dialog.Close>
          </div>

          <form onSubmit={create} className="space-y-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Radiation damage in NiTi shape-memory alloys"
              className="w-full rounded-lg border border-border/70 bg-sidebar px-3 py-2 text-[14px] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
            />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">model</span>
              <ModelSelect value={modelWireId} onChange={setModelWireId} disabled={busy} />
            </div>
            {error && <p className="font-mono text-[11px] text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" size="sm" disabled={!name.trim() || busy}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Workflow size={13} />}
                Create workflow
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

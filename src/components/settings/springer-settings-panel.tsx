"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth/auth-context";

const EXAMPLE_DOI = "10.1007/s10853-025-11875-6";

type Saved = { pdfProviderUrl: string | null; challengeTimeoutSec: number };

export function SpringerSettingsPanel() {
  const { authFetch } = useAuth();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [url, setUrl] = useState("");
  const [timeoutSec, setTimeoutSec] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const apply = (data: Saved) => {
    setSaved(data);
    setUrl(data.pdfProviderUrl ?? "");
    setTimeoutSec(String(data.challengeTimeoutSec));
  };

  useEffect(() => {
    authFetch("/api/settings/springer", { cache: "no-store" })
      .then((res) => res.json())
      .then(apply)
      .catch(() => setError("Failed to load settings"));
  }, [authFetch]);

  const dirty =
    saved !== null &&
    (url.trim() !== (saved.pdfProviderUrl ?? "") || timeoutSec.trim() !== String(saved.challengeTimeoutSec));

  const save = async () => {
    setSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      const res = await authFetch("/api/settings/springer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfProviderUrl: url, challengeTimeoutSec: Number(timeoutSec) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      apply(data);
      setJustSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setJustSaved(false);
  };

  const preview = url.trim() ? `${url.trim().replace(/\/+$/, "")}/${EXAMPLE_DOI}` : null;

  return (
    <div>
      <h2 className="font-display font-semibold text-[16px] mb-1">Springer · PDF provider</h2>
      <p className="text-[13px] text-muted-foreground mb-5">
        Stage 3 of the Springer pipeline opens <code className="font-mono text-[12px]">&lt;provider&gt;/&lt;doi&gt;</code>{" "}
        for each article in a real browser, follows any redirects, and saves the PDF it finds. Articles the
        provider doesn&apos;t have are marked &ldquo;not found&rdquo;.
      </p>

      <label className="block font-mono text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
        Provider base URL
      </label>
      <Input
        value={url}
        onChange={onEdit(setUrl)}
        onKeyDown={(e) => e.key === "Enter" && dirty && save()}
        placeholder="https://myprovider.com"
        disabled={!saved || saving}
      />
      {preview && (
        <p className="font-mono text-[11px] text-muted-foreground mt-2 break-all">
          e.g. {EXAMPLE_DOI} → {preview}
        </p>
      )}

      <label className="block font-mono text-[10px] uppercase tracking-wide text-muted-foreground mt-5 mb-1.5">
        CAPTCHA / browser-check wait (seconds)
      </label>
      <Input
        type="number"
        min={10}
        max={1800}
        value={timeoutSec}
        onChange={onEdit(setTimeoutSec)}
        onKeyDown={(e) => e.key === "Enter" && dirty && save()}
        disabled={!saved || saving}
        className="max-w-[140px]"
      />
      <p className="text-[12px] text-muted-foreground mt-2">
        When the provider shows a &ldquo;checking your browser&rdquo; or CAPTCHA page, stage 3 pauses on it this long
        — solve it in the browser window that opens. The browser keeps its cookies between runs, so once
        you&apos;ve passed the check the following articles usually go straight through.
      </p>

      <div className="flex items-center gap-3 mt-5">
        <Button onClick={save} disabled={!saved || saving || !dirty}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save
        </Button>
        {justSaved && (
          <span className="flex items-center gap-1.5 text-[12px] text-accent">
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
        {error && (
          <span className="flex items-center gap-1.5 text-[12px] text-destructive">
            <AlertTriangle size={13} /> {error}
          </span>
        )}
      </div>

      <p className="font-mono text-[10.5px] text-muted-foreground mt-6">
        PDFs are stored on the server under <code>data/springer-pdfs/&lt;doi&gt;.pdf</code> (override with{" "}
        <code>SPRINGER_PDF_DIR</code>); the browser profile under <code>data/browser-profile</code> (override with{" "}
        <code>SPRINGER_BROWSER_PROFILE_DIR</code>).
      </p>
    </div>
  );
}

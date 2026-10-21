"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, FileDown, Loader2, Play, Settings } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { parseDoi } from "@/lib/doi";
import { formatBytes } from "@/lib/utils";

type Result =
  | { kind: "downloaded"; doi: string; size: number; sourceUrl: string }
  | { kind: "not_found"; doi: string; message: string }
  | { kind: "error"; doi: string; message: string };

export default function DoiImportPage() {
  const { authFetch } = useAuth();
  const [input, setInput] = useState("");
  const [providerUrl, setProviderUrl] = useState<string | null | undefined>(undefined);
  const [fetching, setFetching] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [pdfBusy, setPdfBusy] = useState<"open" | "download" | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const doi = parseDoi(input);

  useEffect(() => {
    authFetch("/api/settings/springer", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setProviderUrl(data.pdfProviderUrl ?? null))
      .catch(() => setProviderUrl(null));
  }, [authFetch]);

  const fetchPdf = async () => {
    if (!doi) return;
    setFetching(true);
    setLog([]);
    setResult(null);
    setPdfError(null);
    try {
      const res = await authFetch("/api/doi/fetch-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream from server");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "start") setLog((l) => [...l, `Opening ${ev.url}…`]);
          if (ev.type === "challenge")
            setLog((l) => [
              ...l,
              `⏳ Browser check / CAPTCHA — solve it in the opened browser window (waiting up to ${ev.timeoutSec}s)…`,
            ]);
          if (ev.type === "downloaded") {
            setLog((l) => [...l, `✓ ${ev.doi} — ${formatBytes(ev.size)} from ${ev.sourceUrl}`]);
            setResult({ kind: "downloaded", doi: ev.doi, size: ev.size, sourceUrl: ev.sourceUrl });
          }
          if (ev.type === "not_found") {
            setLog((l) => [...l, `– ${ev.doi}: not found. ${ev.message}`]);
            setResult({ kind: "not_found", doi: ev.doi, message: ev.message });
          }
          if (ev.type === "error") {
            setLog((l) => [...l, `✗ ${ev.doi}: ${ev.message}`]);
            setResult({ kind: "error", doi: ev.doi, message: ev.message });
          }
        }
      }
    } catch (err) {
      setLog((l) => [...l, err instanceof Error ? err.message : "PDF fetch failed"]);
    } finally {
      setFetching(false);
    }
  };

  // The PDF route needs the Bearer token, which a plain <a href> can't
  // send — so fetch it as a blob and hand the browser an object URL.
  const loadPdf = async (mode: "open" | "download", pdfDoi: string) => {
    setPdfBusy(mode);
    setPdfError(null);
    // Opened synchronously inside the click so popup blockers allow it.
    const tab = mode === "open" ? window.open("", "_blank") : null;
    try {
      const res = await authFetch(`/api/doi/pdf?doi=${encodeURIComponent(pdfDoi)}`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load PDF (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      if (tab) {
        tab.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${pdfDoi.replace(/[^\w.-]+/g, "_")}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      setPdfError(err instanceof Error ? err.message : "Failed to load PDF");
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full px-4 md:px-8 py-6">
        <div className="flex items-center gap-2 mb-1">
          <FileDown size={16} className="text-accent" />
          <h1 className="font-display font-semibold text-[18px]">Import by DOI</h1>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-6 break-all">
          Paste a DOI, a doi.org link, or an article URL. Opens{" "}
          {providerUrl ? `${providerUrl}/<doi>` : "<provider>/<doi>"} in a real browser, follows any redirects, and
          saves the PDF as &lt;doi&gt;.pdf.
        </p>

        <div className="rounded-lg border border-border bg-card p-3.5 mb-4">
          {providerUrl === null ? (
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent hover:underline"
            >
              <Settings size={12} /> Set the provider URL in Settings → Springer first
            </Link>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && doi && !fetching) fetchPdf();
                  }}
                  disabled={fetching}
                  placeholder="https://link.springer.com/article/10.1007/s10853-025-11876-5"
                  className="flex-1 min-w-[240px] rounded-md border border-border bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-accent"
                />
                <Button onClick={fetchPdf} disabled={!doi || fetching || providerUrl === undefined} size="sm">
                  {fetching ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Fetch PDF
                </Button>
              </div>
              <p className="font-mono text-[10.5px] text-muted-foreground mt-2 break-all">
                {input.trim()
                  ? doi
                    ? `doi: ${doi}${providerUrl ? ` → ${providerUrl.replace(/\/+$/, "")}/${doi}` : ""}`
                    : "No DOI found in that input"
                  : "e.g. 10.1007/s10853-025-11876-5 · https://doi.org/10.1007/s10853-025-11876-5"}
              </p>
            </>
          )}
        </div>

        {log.length > 0 && (
          <div className="rounded-lg border border-border bg-sidebar p-3 mb-4 max-h-48 overflow-y-auto scrollbar-thin">
            {log.map((l, i) => (
              <p key={i} className="font-mono text-[10.5px] text-muted-foreground leading-relaxed break-all">
                {l}
              </p>
            ))}
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-display font-semibold text-[13px]">
                  {result.kind === "downloaded"
                    ? `PDF downloaded · ${formatBytes(result.size)}`
                    : result.kind === "not_found"
                      ? "Provider has no PDF for this DOI"
                      : "PDF fetch failed"}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground truncate">{result.doi}</p>
                {result.kind === "downloaded" && (
                  <p className="font-mono text-[10px] text-muted-foreground truncate" title={result.sourceUrl}>
                    {result.sourceUrl}
                  </p>
                )}
              </div>
              {result.kind === "downloaded" && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={pdfBusy !== null} onClick={() => loadPdf("open", result.doi)}>
                    {pdfBusy === "open" ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                    Open
                  </Button>
                  <Button size="sm" disabled={pdfBusy !== null} onClick={() => loadPdf("download", result.doi)}>
                    {pdfBusy === "download" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    Download
                  </Button>
                </div>
              )}
            </div>
            {result.kind !== "downloaded" && (
              <p className="font-mono text-[10.5px] text-muted-foreground mt-2 break-words">{result.message}</p>
            )}
            {pdfError && <p className="font-mono text-[10.5px] text-destructive mt-2">{pdfError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

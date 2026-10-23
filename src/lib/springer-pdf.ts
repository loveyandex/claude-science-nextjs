import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Download, type Response } from "playwright";
import { BROWSER_HEADLESS, BROWSER_USER_AGENT, ensurePlaywrightBrowsers } from "@/lib/springer";

export const PDF_ROOT = path.resolve(
  process.env.SPRINGER_PDF_DIR || path.join(process.cwd(), "data", "springer-pdfs")
);

// A persistent profile (not a throwaway context) so the clearance cookie a
// provider's browser check hands out after it's passed once — by itself or
// by a human solving it in the visible window — is reused for the next
// articles instead of re-challenging every single DOI.
const PROFILE_DIR = path.resolve(
  process.env.SPRINGER_BROWSER_PROFILE_DIR || path.join(process.cwd(), "data", "browser-profile")
);

/**
 * A DOI's own "prefix/suffix" slash becomes a folder, so
 * "10.1007/s10853-025-11875-6" is stored at "10.1007/s10853-025-11875-6.pdf".
 * Characters Windows forbids in file names are replaced, and the result is
 * checked to stay inside PDF_ROOT since the DOI comes from scraped HTML.
 */
export function pdfRelativePath(doi: string): string {
  const segments = doi
    .split("/")
    .map((s) => s.replace(/[<>:"\\|?*\x00-\x1f]/g, "_").trim())
    .filter((s) => s && s !== "." && s !== "..");
  if (segments.length === 0) throw new Error(`Cannot build a file path from DOI "${doi}"`);
  segments[segments.length - 1] += ".pdf";
  return segments.join("/");
}

export function resolvePdfPath(relative: string): string {
  const full = path.resolve(PDF_ROOT, relative);
  if (full !== PDF_ROOT && !full.startsWith(PDF_ROOT + path.sep)) {
    throw new Error("PDF path escapes the storage directory");
  }
  return full;
}

export async function savePdf(doi: string, bytes: Buffer): Promise<{ relativePath: string; size: number }> {
  const relativePath = pdfRelativePath(doi);
  const full = resolvePdfPath(relativePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return { relativePath, size: (await stat(full)).size };
}

export function buildProviderUrl(baseUrl: string, doi: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/${doi}`;
}

export type ProviderPdfResult =
  | { kind: "pdf"; bytes: Buffer; sourceUrl: string }
  | { kind: "not_found"; message: string; finalUrl: string };

const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString("latin1") === "%PDF-";

export class ProviderChallengeError extends Error {}

export type FetchPdfOptions = {
  /** How long to wait on a browser-check / CAPTCHA page for it to clear. */
  challengeTimeoutMs: number;
  /** Called once when a challenge page is detected, before waiting. */
  onChallenge?: () => void;
};

const CHALLENGE_TEXT =
  /checking your browser|verify(ing)? you are (a )?human|just a moment|attention required|are you a robot|captcha|ddos protection|please wait a few seconds|security check/i;
const CHALLENGE_FRAMES =
  'iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], iframe[src*="turnstile"]';

async function looksLikeChallenge(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  if (CHALLENGE_TEXT.test(title)) return true;
  if ((await page.locator(CHALLENGE_FRAMES).count().catch(() => 0)) > 0) return true;
  const text = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  // Only short pages count — a real article page that merely mentions
  // "captcha" somewhere in a long body shouldn't trigger a wait.
  return text.length < 3000 && CHALLENGE_TEXT.test(text);
}

/**
 * Providers answer a DOI in one of a few shapes, all handled here:
 *  - the URL (possibly after redirects to another domain) serves the PDF
 *    itself — shown in Chrome's PDF viewer, or started as a download;
 *  - an HTML page that embeds the PDF (<embed>/<iframe>/<object>) or links
 *    to it;
 *  - a browser-check / CAPTCHA page in front of either of the above: we
 *    wait (up to challengeTimeoutMs) for it to clear — on its own, or by
 *    the user solving it in the visible browser window. Nothing here tries
 *    to solve or evade it;
 *  - an HTML page with just a "not found" style message.
 */
/**
 * One browser kept open for a whole stage-3 batch, so cookies from a
 * passed check — including session-only ones — carry over to the next
 * article, and a window isn't opened/closed per DOI. Relaunches itself if
 * the window was closed mid-batch. Only one batch can hold the profile at a
 * time (Chrome locks it).
 */
export class ProviderBrowser {
  private context: BrowserContext | null = null;

  async get(): Promise<BrowserContext> {
    if (this.context) return this.context;
    ensurePlaywrightBrowsers();
    await mkdir(PROFILE_DIR, { recursive: true });
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: BROWSER_HEADLESS,
      acceptDownloads: true,
      userAgent: BROWSER_USER_AGENT,
    });
    context.on("close", () => {
      if (this.context === context) this.context = null;
    });
    this.context = context;
    return context;
  }

  async close() {
    const context = this.context;
    this.context = null;
    await context?.close().catch(() => {});
  }
}

export async function fetchPdfFromProvider(
  browser: ProviderBrowser,
  providerUrl: string,
  opts: FetchPdfOptions
): Promise<ProviderPdfResult> {
  const context = await browser.get();
  const page = await context.newPage();
  try {

    let pdfResponse: Response | null = null;
    page.on("response", (res) => {
      const type = res.headers()["content-type"] || "";
      if (!pdfResponse && type.toLowerCase().includes("application/pdf")) pdfResponse = res;
    });
    let download: Download | null = null;
    page.on("download", (d) => {
      download ??= d;
    });
    const gotPdfSignal = () => pdfResponse !== null || download !== null;

    // A PDF served as an attachment — or handed straight to Chrome's PDF
    // viewer after a cross-domain redirect — aborts the navigation itself
    // ("Download is starting" / net::ERR_ABORTED). That's not a failure;
    // the bytes are still recoverable below. Other errors (timeout, DNS)
    // are only rethrown if nothing below finds a PDF either.
    let navError: unknown = null;
    try {
      await page.goto(providerUrl, { waitUntil: "load", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    } catch (err) {
      navError = err;
    }
    const aborted = navError != null && /download is starting|ERR_ABORTED/i.test(String(navError));

    if (!navError && !gotPdfSignal() && (await looksLikeChallenge(page))) {
      opts.onChallenge?.();
      const deadline = Date.now() + opts.challengeTimeoutMs;
      let cleared = false;
      while (Date.now() < deadline) {
        await sleep(2000);
        if (gotPdfSignal()) {
          cleared = true;
          break;
        }
        if (!(await looksLikeChallenge(page))) {
          cleared = true;
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
          break;
        }
      }
      if (!cleared) {
        throw new ProviderChallengeError(
          `Browser check / CAPTCHA not cleared within ${Math.round(opts.challengeTimeoutMs / 1000)}s`
        );
      }
    }

    if (aborted) {
      // Chrome often hands the PDF to its viewer instead of emitting a
      // download, so don't wait long — the fallbacks below cover it.
      for (let i = 0; i < 6 && !download; i++) await sleep(500);
    }
    const fromDownload = await readDownload(download);
    if (fromDownload) return { kind: "pdf", bytes: fromDownload.bytes, sourceUrl: fromDownload.url };

    // 1) The PDF response the browser itself already received.
    const seen = pdfResponse as Response | null;
    if (seen) {
      const bytes = await seen.body().catch(() => null);
      if (bytes && isPdf(bytes)) return { kind: "pdf", bytes, sourceUrl: seen.url() };
    }

    const candidates = new Set<string>();
    if (seen) candidates.add(seen.url());
    if (!navError) for (const u of await embeddedPdfUrls(page)) candidates.add(u);
    if (!navError && page.url().startsWith("http")) candidates.add(page.url());
    candidates.add(providerUrl);

    for (const candidate of Array.from(candidates)) {
      // 2) Re-fetch from inside the page: same TLS fingerprint and cookies
      //    as the real browser, which bot-check clearances are tied to.
      const inPage = await fetchInPage(page, candidate);
      if (inPage && isPdf(inPage)) return { kind: "pdf", bytes: inPage, sourceUrl: candidate };
      // 3) The context's request client — shares cookies, follows redirects
      //    across hosts, but isn't the browser's own network stack.
      const res = await context.request.get(candidate, { timeout: 120000 }).catch(() => null);
      if (!res || !res.ok()) continue;
      const bytes = await res.body();
      if (isPdf(bytes)) return { kind: "pdf", bytes, sourceUrl: res.url() };
    }

    if (navError && !aborted) throw navError;
    if (!navError && (await looksLikeChallenge(page))) {
      throw new ProviderChallengeError("Provider is still showing a browser check / CAPTCHA");
    }

    const text = navError
      ? ""
      : (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    return {
      kind: "not_found",
      message: text ? `Provider page: "${text.slice(0, 200)}"` : "Provider returned no PDF",
      finalUrl: navError ? providerUrl : page.url(),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// Only same-origin URLs — a cross-origin fetch from the page would be
// blocked by CORS anyway. The callback deliberately has no named inner
// functions (see embeddedPdfUrls on why).
async function fetchInPage(page: Page, url: string): Promise<Buffer | null> {
  let sameOrigin = false;
  try {
    sameOrigin = new URL(url).origin === new URL(page.url()).origin;
  } catch {}
  if (!sameOrigin) return null;
  const b64 = await page
    .evaluate(async (u) => {
      const r = await fetch(u, { credentials: "include" });
      if (!r.ok) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
      }
      return btoa(bin);
    }, url)
    .catch(() => null);
  return b64 ? Buffer.from(b64, "base64") : null;
}

async function readDownload(download: Download | null): Promise<{ bytes: Buffer; url: string } | null> {
  if (!download) return null;
  const file = await download.path().catch(() => null);
  if (!file) return null;
  const bytes = await readFile(file);
  return isPdf(bytes) ? { bytes, url: download.url() } : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Where a provider's HTML page might point at the actual PDF, most specific first.
const EMBED_SOURCES: [selector: string, attr: string][] = [
  ['embed[type="application/pdf"], embed[src*=".pdf"]', "src"],
  ['object[type="application/pdf"], object[data*=".pdf"]', "data"],
  ['iframe[src*=".pdf"], iframe#pdf', "src"],
  ['a[href*=".pdf"]', "href"],
];

// Attributes are read with evaluateAll + an inline arrow (no named inner
// helpers): bundlers that keep function names (tsx/esbuild keepNames)
// inject a `__name(...)` call into named functions, which doesn't exist
// inside the page and made the whole evaluate throw.
async function embeddedPdfUrls(page: Page): Promise<string[]> {
  const urls: string[] = [];
  for (const [selector, attr] of EMBED_SOURCES) {
    const raws = await page
      .locator(selector)
      .evaluateAll((els, a) => els.map((el) => el.getAttribute(a)), attr)
      .catch(() => [] as (string | null)[]);
    for (const raw of raws) {
      if (!raw || /^(about|javascript|data|blob):/i.test(raw)) continue;
      try {
        urls.push(new URL(raw, page.url()).href);
      } catch {}
    }
  }
  return urls;
}

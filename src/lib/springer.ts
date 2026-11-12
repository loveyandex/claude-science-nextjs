import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

/**
 * Springer's article list and article pages are client-rendered (a plain
 * fetch/BeautifulSoup gets no article data — confirmed by hand before this
 * was written), so every crawl here goes through a real headless browser
 * instead of `fetch`. One browser per call rather than a pooled/shared
 * instance: crawl routes run infrequently (user-triggered batches, not a
 * hot path) and a shared browser would outlive and leak across serverless-
 * style Next.js route invocations.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Default when a caller doesn't choose: a visible browser, so you can watch
// a crawl — and stage 3 needs it to let you solve a provider's CAPTCHA.
export const BROWSER_HEADLESS = false;

export type CrawlOptions = { headless?: boolean };

function playwrightBrowsersLookInstalled(dir: string | undefined): boolean {
  if (!dir || !existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((name) => {
      if (!name.startsWith("chromium")) return false;
      return (
        existsSync(path.join(dir, name, "chrome-win64", "chrome.exe")) ||
        existsSync(path.join(dir, name, "chrome-win", "chrome.exe"))
      );
    });
  } catch {
    return false;
  }
}

// Agent shells set PLAYWRIGHT_BROWSERS_PATH to an empty sandbox cache, so
// Chromium "doesn't exist" even when the real install is in ms-playwright.
export function ensurePlaywrightBrowsers() {
  if (playwrightBrowsersLookInstalled(process.env.PLAYWRIGHT_BROWSERS_PATH)) return;
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : "";
  if (playwrightBrowsersLookInstalled(local)) process.env.PLAYWRIGHT_BROWSERS_PATH = local;
}

// channel "chromium" runs headless mode on the same full Chromium build as
// headed mode, instead of Playwright's separate chrome-headless-shell
// binary — which isn't necessarily installed, and behaves differently
// enough that some sites treat it as a bot.
export function launchBrowser(headless: boolean = BROWSER_HEADLESS) {
  ensurePlaywrightBrowsers();
  return chromium.launch({ headless, channel: "chromium" });
}

async function withPage<T>(fn: (page: Page) => Promise<T>, opts: CrawlOptions = {}): Promise<T> {
  const browser = await launchBrowser(opts.headless);
  try {
    const page = await browser.newPage({ userAgent: BROWSER_USER_AGENT });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export class SpringerCrawlError extends Error {}

// Springer pages keep ad/analytics requests going indefinitely, so waiting
// for "networkidle" regularly times out (seen on article pages even in a
// visible browser). Instead: wait for the HTML, then for the one element
// the caller actually reads. If that element never shows up, carry on —
// callers treat a missing element as "no data" (e.g. past the last page).
async function openPage(page: Page, url: string, readySelector: string) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!res || !res.ok()) {
    throw new SpringerCrawlError(`Springer returned ${res?.status() ?? "no response"} for ${url}`);
  }
  await page.waitForSelector(readySelector, { timeout: 20000 }).catch(() => {});
}

export type SpringerJournalMeta = { name: string; url: string };

/** Fetches the journal's display name from its landing page (`<h1>`). */
export async function fetchJournalMeta(journalId: string): Promise<SpringerJournalMeta> {
  const url = `https://link.springer.com/journal/${journalId}`;
  return withPage(async (page) => {
    await openPage(page, url, "h1");
    const name = await page
      .locator("h1")
      .first()
      .innerText()
      .catch(() => "");
    if (!name.trim()) throw new SpringerCrawlError(`Could not find a journal title on ${url}`);
    return { name: name.trim(), url };
  });
}

export type SpringerListArticle = {
  doi: string;
  href: string;
  title: string;
  section: string | null;
  publishedDate: string | null;
  openAccess: boolean;
};

export type SpringerListPage = {
  articles: SpringerListArticle[];
  totalArticles: number | null;
};

function doiFromHref(href: string): string | null {
  // href looks like "/article/10.1007/s10853-026-13720-w"
  const match = href.match(/\/article\/(10\.\S+)$/);
  return match ? match[1] : null;
}

// The /articles list and an issue's page render the same `app-card-open`
// cards, so both crawls read them through here.
async function readArticleCards(page: Page): Promise<SpringerListArticle[]> {
  const cards = page.locator("article.app-card-open");
  const count = await cards.count();
  const articles: SpringerListArticle[] = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const link = card.locator('a[href*="/article/"]').first();
    const href = await link.getAttribute("href").catch(() => null);
    if (!href) continue;
    const doi = doiFromHref(href);
    if (!doi) continue;

    const title = (await link.innerText().catch(() => "")).trim();
    const metaItems = await card.locator(".c-meta__item").allInnerTexts().catch(() => []);
    const cleaned = metaItems.map((t) => t.trim()).filter(Boolean);
    const section = cleaned[0] ?? null;
    const openAccess = cleaned.some((t) => /open access/i.test(t));
    // On /articles the date is the last c-meta__item, but issue pages add a
    // trailing "Pages: 20143 - 20159" item after it, so match the date's
    // shape ("02 October 2025") rather than its position.
    const publishedDate =
      cleaned.find((t) => /^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(t)) ??
      [...cleaned].reverse().find((t) => !/open access|^pages?:/i.test(t) && t !== section) ??
      null;

    articles.push({ doi, href, title, section, publishedDate, openAccess });
  }
  return articles;
}

/** Crawls one page of a journal's article list (50 articles/page on Springer). */
export async function fetchJournalListPage(
  journalId: string,
  pageNum: number,
  opts: CrawlOptions = {}
): Promise<SpringerListPage> {
  const url = `https://link.springer.com/journal/${journalId}/articles?page=${pageNum}`;
  return withPage(async (page) => {
    await openPage(page, url, "article.app-card-open");
    const articles = await readArticleCards(page);

    // "Showing 1-50 of 48,082 articles"
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const totalMatch = bodyText.match(/of\s+([\d,]+)\s+articles?/i);
    const totalArticles = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : null;

    return { articles, totalArticles };
  }, opts);
}

export type SpringerIssueRef = {
  issue: string; // usually a number, but kept as Springer's own label (e.g. "1-2" for a combined issue)
  month: string | null; // e.g. "November 2025"
  title: string | null; // special-issue caption, when there is one
};

export type SpringerVolume = {
  volume: number;
  period: string | null; // e.g. "January - December 2025"
  issues: SpringerIssueRef[];
};

/**
 * Reads a journal's whole volumes-and-issues index (every volume with its
 * year range and every issue with its month — Springer renders it all on
 * one page), newest volume first, as the site lists it.
 */
export async function fetchJournalVolumes(journalId: string, opts: CrawlOptions = {}): Promise<SpringerVolume[]> {
  const url = `https://link.springer.com/journal/${journalId}/volumes-and-issues`;
  return withPage(async (page) => {
    await openPage(page, url, "li.app-vol-and-issues-item");
    return page.locator("li.app-vol-and-issues-item").evaluateAll((items) =>
      items.flatMap((item) => {
        const heading = item.querySelector("h2");
        const volMatch = heading?.querySelector("span")?.textContent?.match(/Volume\s+(\d+)/i);
        if (!volMatch) return [];
        const issues = Array.from(item.querySelectorAll("li.c-list-group__item")).flatMap((li) => {
          const href = li.querySelector("a")?.getAttribute("href") ?? "";
          const issueMatch = href.match(/\/volumes-and-issues\/\d+-([^/?#]+)/);
          if (!issueMatch) return [];
          // Anything after the link and month (e.g. "SI: Honoring the Legacy of …")
          const extra = Array.from(li.childNodes)
            .filter((n) => n.nodeName !== "A" && n.nodeName !== "TIME")
            .map((n) => n.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
          return [
            {
              issue: decodeURIComponent(issueMatch[1]),
              month: li.querySelector("time")?.textContent?.trim() || null,
              title: extra || null,
            },
          ];
        });
        return [
          {
            volume: parseInt(volMatch[1], 10),
            period: heading?.querySelector("time")?.textContent?.trim() || null,
            issues,
          },
        ];
      })
    );
  }, opts);
}

/**
 * Crawls every article in one issue (`/volumes-and-issues/<volume>-<issue>`).
 * An issue normally fits on one page; if its "N articles in this issue" count
 * says otherwise, follows `?page=` until no new articles turn up.
 */
export async function fetchIssueArticles(
  journalId: string,
  volume: number,
  issue: string,
  opts: CrawlOptions = {}
): Promise<SpringerListPage> {
  const base = `https://link.springer.com/journal/${journalId}/volumes-and-issues/${volume}-${encodeURIComponent(issue)}`;
  return withPage(async (page) => {
    await openPage(page, base, "article.app-card-open");
    const articles = await readArticleCards(page);

    // "40 articles in this issue"
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const totalMatch = bodyText.match(/([\d,]+)\s+articles?\s+in\s+this\s+issue/i);
    const totalArticles = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : null;

    const seen = new Set(articles.map((a) => a.doi));
    for (let p = 2; totalArticles != null && seen.size < totalArticles && p <= 20; p++) {
      await openPage(page, `${base}?page=${p}`, "article.app-card-open");
      const fresh = (await readArticleCards(page)).filter((a) => !seen.has(a.doi));
      if (fresh.length === 0) break;
      for (const a of fresh) {
        seen.add(a.doi);
        articles.push(a);
      }
    }

    return { articles, totalArticles };
  }, opts);
}

export type SpringerArticleDetail = {
  title: string;
  abstract: string | null;
  openAccess: boolean;
  content: string | null;
  // Read from the article's own page, so a single article can be added
  // without its journal's list crawl having seen it first.
  journalId: string | null;
  journalName: string | null;
  section: string | null;
  publishedDate: string | null;
};

/** Crawls a single article's page for its title, abstract, and (if open access) full content. */
export async function fetchArticleDetail(doi: string, opts: CrawlOptions = {}): Promise<SpringerArticleDetail> {
  const url = `https://link.springer.com/article/${doi}`;
  return withPage(async (page) => {
    await openPage(page, url, '[data-test="article-title"], .c-article-title');

    const title = (
      await page
        .locator('[data-test="article-title"], .c-article-title')
        .first()
        .innerText()
        .catch(() => "")
    ).trim();

    const abstract = (
      await page
        .locator("#Abs1-content, .c-article-section__content")
        .first()
        .innerText()
        .catch(() => "")
    ).trim();

    // Springer's site-wide header carries a persistent "Explore open access
    // funding" banner link on every article page, so an unscoped text
    // search for "open access" false-positives on every article regardless
    // of its real access status. The per-article badge only ever appears
    // in the article's own header meta line (`.c-article-header`, same
    // `.c-meta__item` shape as the list page's cards); the CC license link
    // is a second, independent confirmation since it's only ever injected
    // for genuinely open-access articles.
    const badgeVisible = await page
      .locator(".c-article-header")
      .locator("text=/open access/i")
      .first()
      .isVisible()
      .catch(() => false);
    const ccLicenseVisible = await page
      .locator('a[href*="creativecommons.org"]')
      .first()
      .isVisible()
      .catch(() => false);
    const openAccess = badgeVisible || ccLicenseVisible;

    let content: string | null = null;
    if (openAccess) {
      const sections = page.locator(".main-content section[data-title]");
      const sectionCount = await sections.count().catch(() => 0);
      if (sectionCount > 0) {
        const parts: string[] = [];
        for (let i = 0; i < sectionCount; i++) {
          const heading = await sections.nth(i).getAttribute("data-title").catch(() => null);
          const rawText = (await sections.nth(i).innerText().catch(() => "")).trim();
          // The section's own <h2> is already the first line of its
          // innerText, so prepending `## ${heading}` again would duplicate
          // it — strip that leading line first when it matches.
          const text = heading && rawText.startsWith(heading) ? rawText.slice(heading.length).trim() : rawText;
          if (text) parts.push(heading ? `## ${heading}\n\n${text}` : text);
        }
        content = parts.join("\n\n").trim() || null;
      } else {
        const mainText = await page
          .locator(".main-content")
          .first()
          .innerText()
          .catch(() => "");
        content = mainText.trim() || null;
      }
    }

    const journalHrefs = await page
      .locator('a[href*="/journal/"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("href") || ""))
      .catch(() => [] as string[]);
    const journalId =
      journalHrefs.map((h) => h.match(/\/journal\/(\d+)\/?$/)?.[1]).find(Boolean) ??
      doi.match(/^10\.1007\/s(\d{5})-/)?.[1] ??
      null;
    const journalName =
      (await page.locator('meta[name="citation_journal_title"]').getAttribute("content").catch(() => null))?.trim() ||
      null;
    const section =
      (await page.locator('[data-test="article-category"]').first().innerText({ timeout: 2000 }).catch(() => "")).trim() ||
      null;
    const publishedDate =
      (
        await page
          .locator(".c-article-identifiers time, .c-article-header time")
          .first()
          .innerText({ timeout: 2000 })
          .catch(() => "")
      ).trim() || null;

    return {
      title: title || "",
      abstract: abstract || null,
      openAccess,
      content,
      journalId,
      journalName,
      section,
      publishedDate,
    };
  }, opts);
}

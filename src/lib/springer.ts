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
async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export class SpringerCrawlError extends Error {}

export type SpringerJournalMeta = { name: string; url: string };

/** Fetches the journal's display name from its landing page (`<h1>`). */
export async function fetchJournalMeta(journalId: string): Promise<SpringerJournalMeta> {
  const url = `https://link.springer.com/journal/${journalId}`;
  return withPage(async (page) => {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    if (!res || !res.ok()) {
      throw new SpringerCrawlError(`Springer returned ${res?.status() ?? "no response"} for ${url}`);
    }
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

/** Crawls one page of a journal's article list (50 articles/page on Springer). */
export async function fetchJournalListPage(
  journalId: string,
  pageNum: number
): Promise<SpringerListPage> {
  const url = `https://link.springer.com/journal/${journalId}/articles?page=${pageNum}`;
  return withPage(async (page) => {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    if (!res || !res.ok()) {
      throw new SpringerCrawlError(`Springer returned ${res?.status() ?? "no response"} for ${url}`);
    }

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
      // The date is always the last c-meta__item; everything else (type,
      // "Open access") is a fixed prefix of varying length.
      const publishedDate = cleaned.length > 0 ? cleaned[cleaned.length - 1] : null;

      articles.push({
        doi,
        href,
        title,
        section,
        publishedDate: publishedDate && /open access/i.test(publishedDate) ? null : publishedDate,
        openAccess,
      });
    }

    // "Showing 1-50 of 48,082 articles"
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const totalMatch = bodyText.match(/of\s+([\d,]+)\s+articles?/i);
    const totalArticles = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : null;

    return { articles, totalArticles };
  });
}

export type SpringerArticleDetail = {
  title: string;
  abstract: string | null;
  openAccess: boolean;
  content: string | null;
};

/** Crawls a single article's page for its title, abstract, and (if open access) full content. */
export async function fetchArticleDetail(doi: string): Promise<SpringerArticleDetail> {
  const url = `https://link.springer.com/article/${doi}`;
  return withPage(async (page) => {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    if (!res || !res.ok()) {
      throw new SpringerCrawlError(`Springer returned ${res?.status() ?? "no response"} for ${url}`);
    }

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

    return {
      title: title || "",
      abstract: abstract || null,
      openAccess,
      content,
    };
  });
}

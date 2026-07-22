/**
 * Real web search via DuckDuckGo's no-JS HTML endpoint — no API key
 * required. This is the same endpoint duckduckgo.com falls back to
 * without JavaScript, so it's stable but unofficial: DuckDuckGo could
 * change the markup at any time, which would break the regex parsing
 * below. If that happens, the tool degrades to returning zero results
 * rather than throwing, and the model will say so.
 */

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).trim();
}

/** DuckDuckGo's html endpoint wraps outbound links in a redirect; unwrap it to the real URL. */
function unwrapRedirect(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    if (u.pathname === "/l/" && u.searchParams.has("uddg")) {
      return decodeURIComponent(u.searchParams.get("uddg")!);
    }
    return href;
  } catch {
    return href;
  }
}

export async function webSearch(query: string, limit = 5): Promise<WebSearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; locaul-science/1.0)",
    },
    body: new URLSearchParams({ q: query }).toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`DuckDuckGo returned ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const results: WebSearchResult[] = [];

  // Each result sits in a `result__body` block; grab title link + snippet
  // per block rather than one global regex, so a snippet doesn't get
  // matched to the wrong title.
  const blockRe = /<div class="result__body">([\s\S]*?)<\/div>\s*<\/div>/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRe.exec(html)) && results.length < limit) {
    const block = blockMatch[1];

    const linkMatch = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(
      block
    );
    if (!linkMatch) continue;

    const url = unwrapRedirect(decodeEntities(linkMatch[1]));
    const title = stripTags(linkMatch[2]);

    const snippetMatch = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

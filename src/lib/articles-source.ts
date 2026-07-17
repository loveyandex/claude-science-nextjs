const LIST_URL = process.env.ARTICLES_LIST_URL || "";
const BASE_URL = (process.env.ARTICLES_BASE_URL || "").replace(/\/+$/, "");

export class ArticlesSourceError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ArticlesSourceError";
    this.status = status;
  }
}

/** Fetches the JSON array of relative PDF paths from ARTICLES_LIST_URL. */
export async function fetchArticleList(): Promise<string[]> {
  if (!LIST_URL) {
    throw new ArticlesSourceError(
      "ARTICLES_LIST_URL is not configured. Set it in your .env file."
    );
  }
  const res = await fetch(LIST_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new ArticlesSourceError(
      `Fetching article list failed: ${res.status} ${res.statusText}`,
      res.status
    );
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new ArticlesSourceError("ARTICLES_LIST_URL did not return a JSON array.");
  }
  return data as string[];
}

/** Builds the fully-qualified PDF URL for a relative path from the list. */
export function buildPdfUrl(relativePath: string): string {
  if (!BASE_URL) {
    throw new ArticlesSourceError(
      "ARTICLES_BASE_URL is not configured. Set it in your .env file."
    );
  }
  const cleanPath = relativePath.replace(/^\/+/, "");
  return `${BASE_URL}/${cleanPath}`;
}

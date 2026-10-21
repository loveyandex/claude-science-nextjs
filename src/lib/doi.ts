/**
 * Pulls a bare DOI out of whatever the user pasted: a bare DOI, a
 * "doi:" prefix, a doi.org link, or a publisher page such as
 * https://link.springer.com/article/10.1007/s10853-025-11876-5 (or its
 * /content/pdf/<doi>.pdf variant). Returns null if no DOI is found.
 */
export function parseDoi(input: string): string | null {
  let text = input.trim();
  try {
    text = decodeURIComponent(text);
  } catch {}
  const match = text.match(/10\.\d{4,9}\/[^\s?#"'<>]+/);
  if (!match) return null;
  return match[0].replace(/\.pdf$/i, "").replace(/[.,;:)\]}/]+$/, "");
}

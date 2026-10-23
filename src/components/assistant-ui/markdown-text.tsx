"use client";

import { MarkdownTextPrimitive, normalizeMathDelimiters } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
// KaTeX's chemistry extension (\ce{}, \pu{}). Same package as katex — not a
// separate install. \text{} formulas render without it.
import "katex/contrib/mhchem";

/**
 * Shared markdown renderer for both /chat and /chat-assist-ui. Sized and
 * weighted to match claude.ai's actual response typography spec:
 *   font-size: 1rem; font-weight: 400; line-height: 1.5;
 * (the previous 1.7rem line-height and unset base weight read as
 * noticeably bigger/heavier than the real thing).
 *
 * Math uses the packages already in package.json: remark-math finds
 * $...$ / $$...$$, rehype-katex typesets them. normalizeMathDelimiters
 * also accepts \(...\) and \[...\].
 */
// single-dollar math (`$...$`) is remark-math's default. rehype-katex
// retries with throwOnError: false when a formula can't be parsed.
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

// `$` + a digit is usually a price (`$5`), but in these papers it is just as
// often a measurement (`$1.1\text{ m}^2/\text{g}$`). Escaping every one of
// those breaks the opening delimiter, and the leftover `$` then swallows the
// next formula. Keep it when a closing `$` encloses latex or a bare number.
const CURRENCY_DOLLAR = /(^|[^\\$])((?:\\\\)*)\$(?=\d)/g;

function escapeCurrencyOutsideMath(text: string) {
  return text.replace(CURRENCY_DOLLAR, (match, pre: string, slashes: string, offset: number, full: string) => {
    const close = full.indexOf("$", offset + match.length);
    if (close !== -1) {
      const body = full.slice(offset + match.length, close);
      const measurement = body.length <= 400 && !body.includes("\n") && (/[\\^_{}]/.test(body) || /^[\d.+-]+$/.test(body.trim()));
      if (measurement) return match;
    }
    return `${pre}${slashes}\\$`;
  });
}

function preprocess(text: string) {
  return escapeCurrencyOutsideMath(normalizeMathDelimiters(text));
}

export const MarkdownText = () => (
  <MarkdownTextPrimitive
    remarkPlugins={remarkPlugins}
    rehypePlugins={rehypePlugins}
    preprocess={preprocess}
    className="chat-markdown text-base font-normal leading-normal"
  />
);

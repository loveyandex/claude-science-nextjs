"use client";

import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared markdown renderer for both /chat and /chat-assist-ui. Sized and
 * weighted to match claude.ai's actual response typography spec:
 *   font-size: 1rem; font-weight: 400; line-height: 1.5;
 * (the previous 1.7rem line-height and unset base weight read as
 * noticeably bigger/heavier than the real thing).
 */
export const MarkdownText = () => (
  <MarkdownTextPrimitive
    remarkPlugins={[remarkGfm]}
    className="chat-markdown text-base font-normal leading-normal"
  />
);

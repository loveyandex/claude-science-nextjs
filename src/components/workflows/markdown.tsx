"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

/** Plain markdown block for agent-written text (findings, notes, reports) outside the chat thread. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("chat-markdown chat-markdown-wrap text-[13.5px] leading-relaxed text-foreground", className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

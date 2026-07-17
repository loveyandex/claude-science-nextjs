"use client";

import {
  AuiIf,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Sparkle,
  RefreshCcw,
  Copy,
  Check,
  Search,
  Square,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

// The Text slot expects a component with no meaningful external props (it
// reads the streamed content from context) — wrapping like this is the
// documented pattern so the prop shapes don't fight each other.
const MarkdownText = () => (
  <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="chat-markdown" />
);

const actionButton =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground";

export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col items-stretch bg-background font-serif text-foreground">
      <AuiIf condition={(s) => s.thread.isEmpty}>
        <EmptyState />
      </AuiIf>
      <AuiIf condition={(s) => !s.thread.isEmpty}>
        <ThreadPrimitive.Viewport className="flex grow flex-col overflow-y-auto scrollbar-thin px-4 pt-10">
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === "user" ? <UserMessage /> : <AssistantMessage />
            }
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto w-full max-w-3xl bg-gradient-to-b from-transparent via-background/85 to-background pt-4 pb-3">
            <Composer />
            <p className="pt-2.5 text-center font-mono text-[11px] text-muted-foreground">
              Grounded in your indexed library — searches it before answering.
            </p>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </AuiIf>
    </ThreadPrimitive.Root>
  );
}

function EmptyState() {
  const prompts = [
    "What delivery mechanisms show up most in the indexed papers?",
    "Summarize what's indexed about CRISPR off-target safety.",
    "Any papers on blood-brain-barrier delivery?",
  ];
  return (
    <div className="flex grow flex-col items-center justify-center px-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-stretch gap-6">
        <h1 className="flex items-center justify-center gap-3 font-serif text-3xl text-foreground sm:text-4xl">
          <Sparkle className="size-7 fill-accent text-accent" />
          <span>How can I help you today?</span>
        </h1>
        <Composer />
        <div className="flex flex-wrap items-center justify-center gap-2">
          {prompts.map((p) => (
            <ThreadPrimitive.Suggestion
              key={p}
              prompt={p}
              send
              className="rounded-lg border border-border bg-transparent px-3.5 py-2 font-serif text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              {p}
            </ThreadPrimitive.Suggestion>
          ))}
        </div>
      </div>
    </div>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-card px-4 pt-3.5 pb-3 shadow-sm">
      <ComposerPrimitive.Input
        placeholder="How can I help you today?"
        rows={1}
        className="block max-h-72 min-h-7 w-full resize-none bg-transparent font-serif text-base text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex w-full items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          asks your indexed library first
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ComposerPrimaryAction />
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

function ComposerPrimaryAction() {
  return (
    <>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:opacity-90">
          <Square className="size-3.5 fill-current" />
        </ComposerPrimitive.Cancel>
      </AuiIf>
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-40">
          <ArrowUp className="size-4" strokeWidth={2.4} />
        </ComposerPrimitive.Send>
      </AuiIf>
    </>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="group/message relative mx-auto flex w-full max-w-3xl flex-col items-end gap-1 py-2">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-sidebar px-4 py-2.5 text-base text-foreground">
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      </div>
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="-mt-px flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
      >
        <ActionBarPrimitive.Copy className={actionButton}>
          <AuiIf condition={(s) => s.message.isCopied}>
            <Check className="size-4" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <Copy className="size-4" />
          </AuiIf>
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group/message relative mx-auto flex w-full max-w-3xl flex-col py-2">
      <div className="font-serif text-base leading-[1.7rem] text-foreground chat-markdown-wrap">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            tools: { Fallback: ToolFallback },
          }}
        />
      </div>
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="mt-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
      >
        <ActionBarPrimitive.Copy className={actionButton}>
          <AuiIf condition={(s) => s.message.isCopied}>
            <Check className="size-4" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <Copy className="size-4" />
          </AuiIf>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.FeedbackPositive className={actionButton}>
          <ThumbsUp className="size-4" />
        </ActionBarPrimitive.FeedbackPositive>
        <ActionBarPrimitive.FeedbackNegative className={actionButton}>
          <ThumbsDown className="size-4" />
        </ActionBarPrimitive.FeedbackNegative>
        <ActionBarPrimitive.Reload className={actionButton}>
          <RefreshCcw className="size-4" />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

/** Generic renderer for any tool call (e.g. searchArticles) that doesn't have a bespoke UI. */
function ToolFallback({ toolName, argsText, result }: any) {
  return (
    <div className="my-2.5 rounded-lg border border-border bg-sidebar px-3.5 py-2.5 font-body">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-accent">
        <Search size={11} /> {toolName}
      </div>
      {argsText && (
        <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">{argsText}</p>
      )}
      {result !== undefined && (
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {typeof result === "object" && result?.count !== undefined
            ? `Found ${result.count} matching paper${result.count === 1 ? "" : "s"} in the library.`
            : "Done."}
        </p>
      )}
    </div>
  );
}

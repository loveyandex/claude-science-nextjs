"use client";

import {
  AuiIf,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
} from "@assistant-ui/react";
import {
  ArrowUp,
  Sparkle,
  RefreshCcw,
  Copy,
  Check,
  Square,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { StepFlowParts } from "@/components/assistant-ui/step-flow";
import { ModelPicker } from "@/components/assistant-ui/model-picker";

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
              className="rounded-lg border border-border/60 bg-transparent px-3.5 py-2 font-serif text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
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
    <ComposerPrimitive.Root className="flex w-full flex-col gap-2 rounded-2xl border border-border/70 bg-card px-4 pt-3.5 pb-3 shadow-sm">
      <ComposerPrimitive.Input
        placeholder="How can I help you today?"
        rows={1}
        className="block max-h-72 min-h-7 w-full resize-none bg-transparent font-serif text-base text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex w-full items-center gap-2">
        <ModelPicker />
        <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
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
      <div className="font-serif font-normal text-foreground chat-markdown-wrap">
        <StepFlowParts />
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

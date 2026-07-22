"use client";

/**
 * A fuller, more literal recreation of assistant-ui's own "Claude Clone"
 * reference example (https://www.assistant-ui.com/examples/claude), kept as
 * a separate page so it can be iterated on / compared against the
 * production `/chat` Thread without risk. Uses the same theme tokens and
 * the same `/api/chat` backend (searchArticles tool over the Article
 * table), just a richer composer chrome (topic chips, attachments row,
 * dictation/cancel states) matching the official example's feature set.
 */

import { useEffect, useState } from "react";
import {
  ActionBarPrimitive,
  AuiIf,
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowUp,
  Check,
  Copy,
  FlaskConical,
  Pencil,
  Plus,
  RefreshCcw,
  Shield,
  Sparkle,
  Square,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { StepFlowParts } from "@/components/assistant-ui/step-flow";
import { ModelPicker } from "@/components/assistant-ui/model-picker";

const actionButton =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground";

export function ThreadAssistUI() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col items-stretch bg-background font-serif text-foreground">
      <AuiIf condition={(s) => s.thread.isEmpty}>
        <EmptyState />
      </AuiIf>
      <AuiIf condition={(s) => !s.thread.isEmpty}>
        <ThreadPrimitive.Viewport className="flex grow flex-col overflow-y-auto scrollbar-thin px-4 pt-10">
          <ThreadPrimitive.Messages>
            {() => <ChatMessage />}
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto w-full max-w-3xl bg-gradient-to-b from-transparent via-background/85 to-background pt-4 pb-3">
            <Composer />
            <p className="pt-2.5 text-center font-mono text-[11px] text-muted-foreground">
              assistant-ui reference build — same /api/chat backend as the main Chat page.
            </p>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </AuiIf>
    </ThreadPrimitive.Root>
  );
}

const EmptyState = () => (
  <div className="flex grow flex-col items-center justify-center px-4">
    <div className="mx-auto flex w-full max-w-2xl flex-col items-stretch gap-5">
      <h1 className="flex items-center justify-center gap-3 font-serif text-3xl text-foreground sm:text-4xl">
        <Sparkle className="size-7 fill-accent text-accent" />
        <span>How can I help you today?</span>
      </h1>
      <Composer />
      <TopicChips />
    </div>
  </div>
);

const Composer = () => {
  return (
    <ComposerPrimitive.Root className="flex w-full flex-col gap-2 rounded-2xl border border-border/70 bg-card px-3.5 pt-3 pb-2.5 shadow-sm">
      <ComposerPrimitive.Input
        placeholder="How can I help you today?"
        rows={1}
        className="block max-h-72 min-h-6 w-full resize-none bg-transparent font-serif text-base text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex w-full items-center gap-2">
        <ComposerPrimitive.AddAttachment
          aria-label="Add attachment"
          className={actionButton + " shrink-0"}
        >
          <Plus className="size-4" />
        </ComposerPrimitive.AddAttachment>
        <ModelPicker />
        <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
          same local library as /chat
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ComposerPrimaryAction />
        </div>
      </div>
      <AuiIf condition={(s) => s.composer.attachments.length > 0}>
        <div className="-mx-1 -mb-1 flex flex-row gap-2 overflow-x-auto pt-1">
          <ComposerPrimitive.Attachments>
            {() => <ChatAttachment />}
          </ComposerPrimitive.Attachments>
        </div>
      </AuiIf>
    </ComposerPrimitive.Root>
  );
};

const ComposerPrimaryAction = () => {
  return (
    <>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors hover:opacity-90">
          <Square className="size-3 fill-current" />
        </ComposerPrimitive.Cancel>
      </AuiIf>
      <AuiIf condition={(s) => !s.thread.isRunning && !s.composer.isEmpty}>
        <ComposerPrimitive.Send className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-50">
          <ArrowUp className="size-4" strokeWidth={2.4} />
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => !s.thread.isRunning && s.composer.isEmpty}>
        <div className="flex size-8 items-center justify-center rounded-md text-muted-foreground/40">
          <ArrowUp className="size-4" strokeWidth={2.4} />
        </div>
      </AuiIf>
    </>
  );
};

const TOPICS = [
  { label: "Delivery mechanisms", Icon: FlaskConical, prompt: "What delivery mechanisms show up most across the indexed papers?" },
  { label: "Safety & off-target", Icon: Shield, prompt: "Summarize what's indexed about off-target safety." },
  { label: "Recent additions", Icon: Sparkle, prompt: "What are the most recently indexed papers, and what do they cover?" },
];

const TopicChips = () => (
  <div className="flex flex-wrap items-center justify-center gap-2">
    {TOPICS.map(({ label, Icon, prompt }) => (
      <ThreadPrimitive.Suggestion
        key={label}
        prompt={prompt}
        send
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-transparent px-3 text-sm whitespace-nowrap text-foreground transition-colors hover:bg-foreground/5"
      >
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="font-serif">{label}</span>
      </ThreadPrimitive.Suggestion>
    ))}
  </div>
);

const ChatMessage = () => {
  return (
    <MessagePrimitive.Root className="group/message relative mx-auto flex w-full max-w-3xl flex-col py-2">
      <AuiIf condition={(s) => s.message.role === "user"}>
        <div className="flex flex-col items-end gap-1">
          <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-sidebar px-4 py-2.5 text-base text-foreground">
            <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
          </div>
          <ActionBarPrimitive.Root className="-mt-px flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
            <ActionBarPrimitive.Edit className={actionButton}>
              <Pencil className="size-4" />
            </ActionBarPrimitive.Edit>
            <ActionBarPrimitive.Copy className={actionButton}>
              <AuiIf condition={(s) => s.message.isCopied}>
                <Check className="size-4" />
              </AuiIf>
              <AuiIf condition={(s) => !s.message.isCopied}>
                <Copy className="size-4" />
              </AuiIf>
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </div>
      </AuiIf>

      <AuiIf condition={(s) => s.message.role === "assistant"}>
        <div className="flex flex-col">
          <div className="font-serif font-normal text-foreground chat-markdown-wrap">
            <StepFlowParts />
          </div>
          <ActionBarPrimitive.Root className="mt-2 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
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
        </div>
      </AuiIf>
    </MessagePrimitive.Root>
  );
};


const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return src;
};

const ChatAttachment = () => {
  const isImage = useAuiState((s) => s.attachment.type === "image");
  const file = useAuiState((s) => (s.attachment.type === "image" ? s.attachment.file : undefined));
  const src = useFileSrc(file);

  return (
    <AttachmentPrimitive.Root className="group/thumbnail relative">
      <div
        className="overflow-hidden rounded-lg border border-border/70"
        style={{ width: "72px", height: "72px" }}
      >
        {isImage && src ? (
          <img className="h-full w-full object-cover" alt="Attachment" src={src} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-sidebar text-muted-foreground">
            <AttachmentPrimitive.unstable_Thumb className="text-xs" />
          </div>
        )}
      </div>
      <AttachmentPrimitive.Remove
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-focus-within/thumbnail:opacity-100 group-hover/thumbnail:opacity-100"
        aria-label="Remove attachment"
      >
        <X className="size-3" />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
};

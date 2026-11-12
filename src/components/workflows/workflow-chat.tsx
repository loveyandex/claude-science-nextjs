"use client";

import { useMemo } from "react";
import type { UIMessage } from "ai";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { ArrowUp, Bot, Check, Copy, RefreshCcw, Square } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { StepFlowParts } from "@/components/assistant-ui/step-flow";

const SUGGESTIONS = [
  { label: "Help me write the brief", prompt: "Help me write a clear brief for this workflow. Ask me what you need to know." },
  { label: "Start the research", prompt: "The brief looks good — start a research run." },
  { label: "What's the status?", prompt: "What is the workflow doing right now, and how far along is it?" },
  { label: "Summarize findings", prompt: "Summarize the findings so far, with their sources." },
];

const actionButton =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground";

/**
 * Right-hand chat pane of /workflow/[id]. Each turn is a durable workflow
 * run (researchChatTurn); WorkflowChatTransport reconnects to it if the
 * response stream drops, and the server stores the conversation itself.
 */
export function WorkflowChat({
  workflowId,
  initialMessages,
  onTurnEnd,
}: {
  workflowId: string;
  initialMessages: UIMessage[];
  onTurnEnd?: () => void;
}) {
  const { getToken } = useAuth();

  const transport = useMemo(() => {
    const headers = (): Record<string, string> => {
      const token = getToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    };
    return new WorkflowChatTransport<UIMessage>({
      api: `/api/workflows/${workflowId}/chat`,
      maxConsecutiveErrors: 5,
      prepareSendMessagesRequest: ({ messages, api }) => ({
        api,
        body: { messages },
        headers: { ...headers(), "Content-Type": "application/json" },
      }),
      prepareReconnectToStreamRequest: ({ api }) => ({ api, headers: headers() }),
      onChatEnd: () => onTurnEnd?.(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, getToken]);

  const runtime = useChatRuntime({ id: `workflow-${workflowId}`, messages: initialMessages, transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full flex-col bg-background font-serif text-foreground">
        <ThreadPrimitive.Viewport className="flex grow flex-col overflow-y-auto scrollbar-thin px-3 pt-4">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <EmptyState />
          </AuiIf>
          <ThreadPrimitive.Messages>{() => <ChatMessage />}</ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto w-full bg-gradient-to-b from-transparent via-background/90 to-background pb-3 pt-3">
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function EmptyState() {
  return (
    <div className="flex grow flex-col justify-center gap-4 px-1 pb-6">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Bot size={16} />
        </div>
        <div>
          <p className="font-display text-[14px] font-semibold">Workflow assistant</p>
          <p className="font-mono text-[10.5px] text-muted-foreground">
            shapes the brief · starts &amp; stops runs · reports progress
          </p>
        </div>
      </div>
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        Tell me what you want investigated — I&apos;ll turn it into a brief, run the research in the background and
        answer questions about what it found, now or days from now.
      </p>
      <div className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <ThreadPrimitive.Suggestion
            key={s.label}
            prompt={s.prompt}
            send
            className="rounded-lg border border-border/60 px-3 py-2 text-left font-sans text-[12.5px] text-foreground transition-colors hover:border-accent/50 hover:bg-sidebar"
          >
            {s.label}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex w-full flex-col gap-1.5 rounded-2xl border border-border/70 bg-card px-3 pb-2 pt-2.5 shadow-sm">
      <ComposerPrimitive.Input
        placeholder="Describe the research, ask for status, or say “start”…"
        rows={1}
        className="block max-h-48 min-h-10 w-full resize-none bg-transparent font-serif text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground">durable chat · survives reloads</span>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground hover:opacity-90">
            <Square className="size-3 fill-current" />
          </ComposerPrimitive.Cancel>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
            <ArrowUp className="size-4" strokeWidth={2.4} />
          </ComposerPrimitive.Send>
        </AuiIf>
      </div>
    </ComposerPrimitive.Root>
  );
}

function ChatMessage() {
  return (
    <MessagePrimitive.Root className="group/message relative flex w-full flex-col py-1.5">
      <AuiIf condition={(s) => s.message.role === "user"}>
        <div className="flex justify-end">
          <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-user-message px-3.5 py-2 text-[15px]">
            <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
          </div>
        </div>
      </AuiIf>
      <AuiIf condition={(s) => s.message.role === "assistant"}>
        <div className="chat-markdown-wrap text-[15px]">
          <StepFlowParts />
        </div>
        <ActionBarPrimitive.Root className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100">
          <ActionBarPrimitive.Copy className={actionButton}>
            <AuiIf condition={(s) => s.message.isCopied}>
              <Check className="size-3.5" />
            </AuiIf>
            <AuiIf condition={(s) => !s.message.isCopied}>
              <Copy className="size-3.5" />
            </AuiIf>
          </ActionBarPrimitive.Copy>
          <ActionBarPrimitive.Reload className={actionButton}>
            <RefreshCcw className="size-3.5" />
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
      </AuiIf>
    </MessagePrimitive.Root>
  );
}

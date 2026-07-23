"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport, type UIMessage } from "ai";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useAuth } from "@/components/auth/auth-context";
import { ModelProvider, useModelSelection } from "@/components/assistant-ui/model-context";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadAssistUI } from "@/components/assistant-ui/thread-assist-ui";
import { Skeleton } from "@/components/ui/skeleton";

type ChatRecord = {
  id: string;
  mode: "chat" | "chat-assist-ui";
  title: string;
  model: string;
  thinking: boolean;
  messages: UIMessage[];
};

type LoadStatus = "loading" | "ready" | "not-found";

/**
 * Loads a persisted chat by id and mounts the appropriate Thread once ready.
 * Used by both /c/[chatId] (mode "chat") and /c-assist-ui/[chatId]
 * (mode "chat-assist-ui") — the two pages differ only in which mode they
 * pass and which Thread renders, everything else (fetch, hydration,
 * transport wiring) is identical, so it lives here once.
 */
export function ChatSession({ chatId, mode }: { chatId: string; mode: ChatRecord["mode"] }) {
  const { authFetch } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [chat, setChat] = useState<ChatRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    authFetch(`/api/chats/${chatId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setStatus("not-found");
          return;
        }
        const data = await res.json();
        setChat(data.chat);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("not-found");
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, authFetch]);

  useEffect(() => {
    if (status === "not-found") {
      const fallback = mode === "chat-assist-ui" ? "/chat-assist-ui" : "/chat";
      router.replace(fallback);
    }
  }, [status, mode, router]);

  if (status !== "ready" || !chat) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="space-y-4">
          <Skeleton className="ml-auto h-10 w-2/3" />
          <Skeleton className="h-24 w-4/5" />
          <Skeleton className="ml-auto h-10 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <ModelProvider initialModel={chat.model} initialThinking={chat.thinking}>
      <ChatRuntime chatId={chatId} mode={mode} initialMessages={chat.messages} />
    </ModelProvider>
  );
}

function ChatRuntime({
  chatId,
  mode,
  initialMessages,
}: {
  chatId: string;
  mode: ChatRecord["mode"];
  initialMessages: UIMessage[];
}) {
  const { getRequestBody } = useModelSelection();
  const { getToken } = useAuth();

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ ...getRequestBody(), chatId }),
        headers: (): Record<string, string> => {
          const token = getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, getRequestBody, getToken]
  );

  const runtime = useChatRuntime({ id: chatId, messages: initialMessages, transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {mode === "chat-assist-ui" ? <ThreadAssistUI /> : <Thread />}
    </AssistantRuntimeProvider>
  );
}

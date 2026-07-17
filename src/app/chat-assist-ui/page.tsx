"use client";

import { useMemo } from "react";
import { DefaultChatTransport } from "ai";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { ThreadAssistUI } from "@/components/assistant-ui/thread-assist-ui";

export default function ChatAssistUIPage() {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadAssistUI />
    </AssistantRuntimeProvider>
  );
}

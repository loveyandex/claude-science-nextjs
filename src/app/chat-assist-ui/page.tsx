"use client";

import { useMemo } from "react";
import { DefaultChatTransport } from "ai";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { ThreadAssistUI } from "@/components/assistant-ui/thread-assist-ui";
import { ModelProvider, useModelSelection } from "@/components/assistant-ui/model-context";

export default function ChatAssistUIPage() {
  return (
    <ModelProvider>
      <ChatAssistUIPageInner />
    </ModelProvider>
  );
}

function ChatAssistUIPageInner() {
  const { getRequestBody } = useModelSelection();

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", body: getRequestBody }),
    [getRequestBody]
  );
  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadAssistUI />
    </AssistantRuntimeProvider>
  );
}

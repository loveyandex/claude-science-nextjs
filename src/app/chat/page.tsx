"use client";

import { useMemo } from "react";
import { DefaultChatTransport } from "ai";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import { ModelProvider, useModelSelection } from "@/components/assistant-ui/model-context";

export default function ChatPage() {
  return (
    <ModelProvider>
      <ChatPageInner />
    </ModelProvider>
  );
}

function ChatPageInner() {
  const { getRequestBody } = useModelSelection();

  // `body` as a function is re-read fresh on every send, so the model
  // picker / thinking toggle can change mid-session without needing to
  // recreate the transport (which would drop in-flight runtime state).
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", body: getRequestBody }),
    [getRequestBody]
  );
  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}

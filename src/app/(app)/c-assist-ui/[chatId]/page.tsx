"use client";

import { ChatSession } from "@/components/chat-session";

export default function ChatAssistUIByIdPage({ params }: { params: { chatId: string } }) {
  return <ChatSession chatId={params.chatId} mode="chat-assist-ui" />;
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";

/**
 * Mounted by /chat and /chat-assist-ui (no id in the URL yet). Creates an
 * empty Chat row immediately and redirects to /c/[id] or /c-assist-ui/[id].
 *
 * This "create eagerly, redirect immediately" approach (rather than only
 * creating the row once the user sends their first message) trades a small
 * amount of URL purity for a lot of robustness: it avoids navigating away
 * mid-stream, which would otherwise unmount the Thread's runtime and
 * interrupt an in-flight response. The cost is that visiting /chat and
 * leaving without sending anything leaves behind an empty "New chat" row —
 * /recent's query filters those out (WHERE messages is not an empty array)
 * so they don't clutter the history list.
 */
export function NewChatRedirect({ mode }: { mode: "chat" | "chat-assist-ui" }) {
  const { authFetch } = useAuth();
  const router = useRouter();
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;

    authFetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to create chat");
        const data = await res.json();
        const base = mode === "chat-assist-ui" ? "/c-assist-ui" : "/c";
        router.replace(`${base}/${data.chat.id}`);
      })
      .catch(() => {
        // Rare (DB unreachable, etc.) — surface nothing fancy, just stay put
        // with the loading state; a refresh will retry chat creation.
      });
  }, [authFetch, router, mode]);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 size={18} className="animate-spin text-muted-foreground" />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, MessageSquare, Bot, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ChatListItem = {
  id: string;
  mode: "chat" | "chat-assist-ui";
  title: string;
  model: string;
  updatedAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

const LIMIT = 20;

export default function RecentPage() {
  const { authFetch } = useAuth();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [chats, setChats] = useState<ChatListItem[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (debouncedQuery) params.set("q", debouncedQuery);
    authFetch(`/api/chats?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setChats(data.chats ?? []);
        setPagination(data.pagination ?? null);
      })
      .catch(() => {
        setChats([]);
        setPagination(null);
      });
  }, [authFetch, page, debouncedQuery]);

  useEffect(() => {
    setChats(null); // show skeleton while (re)loading
    load();
  }, [load]);

  const onDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await authFetch(`/api/chats/${id}`, { method: "DELETE" });
      load();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-8">
        <h1 className="font-display text-xl font-semibold text-foreground">Recent chats</h1>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {pagination ? `${pagination.total} total` : "\u00A0"}
        </p>

        <div className="mt-5 flex items-center gap-2 rounded-lg border border-border/70 bg-sidebar px-3 py-2 focus-within:border-accent transition-colors">
          <Search size={14} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your chats by title..."
            className="flex-1 bg-transparent text-[13px] font-body text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="mt-4 space-y-1.5">
          {chats === null &&
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}

          {chats !== null && chats.length === 0 && (
            <p className="py-10 text-center font-mono text-[12px] text-muted-foreground">
              {debouncedQuery ? "No chats match that search." : "No chats yet — start one from Chat."}
            </p>
          )}

          {chats?.map((chat) => (
            <ChatRow key={chat.id} chat={chat} onDelete={onDelete} deleting={deletingId === chat.id} />
          ))}
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={14} /> prev
            </Button>
            <span className="font-mono text-[11px] text-muted-foreground">
              page {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              next <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatRow({
  chat,
  onDelete,
  deleting,
}: {
  chat: ChatListItem;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const href = chat.mode === "chat-assist-ui" ? `/c-assist-ui/${chat.id}` : `/c/${chat.id}`;
  const Icon = chat.mode === "chat-assist-ui" ? Bot : MessageSquare;

  return (
    <div className="group flex animate-fade-in items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-foreground/5">
      <Icon size={15} className="shrink-0 text-muted-foreground" />
      <Link href={href} className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-foreground">{chat.title}</p>
        <p className="font-mono text-[10.5px] text-muted-foreground">
          {relativeTime(chat.updatedAt)} · {chat.model}
        </p>
      </Link>
      <button
        onClick={() => onDelete(chat.id)}
        disabled={deleting}
        aria-label="Delete chat"
        className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

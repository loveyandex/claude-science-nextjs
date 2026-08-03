"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, MessageSquare, Library, Database, Bot, Search, LogOut, ScanEye, Settings, Boxes } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { STAT_PAPERS_INDEXED } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-context";

const NAV_ITEMS = [
  {
    href: "/chat",
    label: "Chat",
    icon: MessageSquare,
    isActive: (p: string) => p === "/chat" || p.startsWith("/c/"),
  },
  {
    href: "/chat-assist-ui",
    label: "Chat (assistant-ui)",
    icon: Bot,
    isActive: (p: string) => p === "/chat-assist-ui" || p.startsWith("/c-assist-ui/"),
  },
  {
    href: "/library",
    label: "Library",
    icon: Library,
    isActive: (p: string) => p.startsWith("/library"),
  },
  {
    href: "/make-science",
    label: "Index",
    icon: Database,
    // Exact-ish match, not a bare startsWith — "/make-science-gemma4" would
    // otherwise also match this prefix (same bug class already fixed once
    // for /chat vs /chat-assist-ui).
    isActive: (p: string) => p === "/make-science",
  },
  {
    href: "/make-science-gemma4",
    label: "Index (gemma4)",
    icon: ScanEye,
    isActive: (p: string) => p === "/make-science-gemma4",
  },
  {
    href: "/make-embedding",
    label: "Embed",
    icon: Boxes,
    isActive: (p: string) => p === "/make-embedding",
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const { user, logout } = useAuth();

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      {/* Icon rail (desktop) */}
      <aside className="hidden md:flex flex-col items-center w-14 shrink-0 bg-sidebar py-4 gap-1">
        <div className="w-8 h-8 rounded-md bg-foreground flex items-center justify-center mb-4">
          <Sparkles size={15} className="text-accent" strokeWidth={2.2} />
        </div>
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "w-10 h-10 rounded-md flex items-center justify-center transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-border/50 hover:text-foreground"
              )}
            >
              <Icon size={17} />
            </Link>
          );
        })}

        <div className="flex-1" />

        <Link
          href="/recent"
          title="Recent chats"
          className={cn(
            "w-10 h-10 rounded-md flex items-center justify-center transition-colors",
            pathname.startsWith("/recent")
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-border/50 hover:text-foreground"
          )}
        >
          <Search size={17} />
        </Link>
        <Link
          href="/settings"
          title="Settings"
          className={cn(
            "w-10 h-10 rounded-md flex items-center justify-center transition-colors",
            pathname.startsWith("/settings")
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-border/50 hover:text-foreground"
          )}
        >
          <Settings size={17} />
        </Link>
        <button
          onClick={logout}
          title="Log out"
          className="w-10 h-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut size={16} />
        </button>
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-background shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-foreground flex items-center justify-center md:hidden">
              <Sparkles size={14} className="text-accent" strokeWidth={2.2} />
            </div>
            <div className="leading-tight">
              <h1 className="font-display font-semibold text-[15px] tracking-tight">
                locaul science
              </h1>
              <p className="font-mono text-[10px] text-muted-foreground">
                {STAT_PAPERS_INDEXED} papers indexed
              </p>
            </div>
          </div>

          {/* mobile nav */}
          <nav className="flex md:hidden bg-sidebar rounded-lg p-0.5">
            {NAV_ITEMS.map((item) => {
              const active = item.isActive(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-md font-mono text-[11px] transition-colors",
                    active ? "bg-card text-foreground" : "text-muted-foreground"
                  )}
                >
                  <Icon size={12} /> {item.label}
                </Link>
              );
            })}
            <Link
              href="/recent"
              className={cn(
                "flex items-center gap-1 px-2.5 py-1.5 rounded-md font-mono text-[11px] transition-colors",
                pathname.startsWith("/recent") ? "bg-card text-foreground" : "text-muted-foreground"
              )}
            >
              <Search size={12} />
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              {user?.email ?? "indexed & grounded locally"}
            </div>
            <Link
              href="/settings"
              className={cn(
                "md:hidden transition-colors",
                pathname.startsWith("/settings") ? "text-accent" : "text-muted-foreground"
              )}
              title="Settings"
            >
              <Settings size={15} />
            </Link>
            <button
              onClick={logout}
              className="md:hidden text-muted-foreground hover:text-destructive transition-colors"
              title="Log out"
            >
              <LogOut size={15} />
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
}

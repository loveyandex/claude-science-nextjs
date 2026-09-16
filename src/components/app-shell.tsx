"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, MessageSquare, Library, Database, Bot, Search, LogOut, ScanEye, Settings, Boxes, Menu, X, BookMarked } from "lucide-react";
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
  {
    href: "/springer",
    label: "Springer",
    icon: BookMarked,
    isActive: (p: string) => p.startsWith("/springer"),
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

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              {user?.email ?? "indexed & grounded locally"}
            </div>
            <ThemeToggle />
            <MobileNav pathname={pathname} email={user?.email} logout={logout} />
          </div>
        </header>

        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
}

/**
 * Below md (768px) the icon rail (`aside`, `hidden md:flex`) is gone, so
 * every destination it carries — the 6 NAV_ITEMS plus Recent/Settings/
 * Logout, previously scattered across separate always-visible icon
 * buttons that quietly overflowed the header on narrow viewports — has to
 * live somewhere. This consolidates all of it into one hamburger-triggered
 * dropdown instead, so the header itself never grows wider than the
 * viewport regardless of how many nav items exist.
 */
function MobileNav({
  pathname,
  email,
  logout,
}: {
  pathname: string;
  email: string | undefined;
  logout: () => void;
}) {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-border/50 hover:text-foreground transition-colors"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      {open && (
        <>
          {/* Backdrop — click to dismiss, sits under the panel but above page content. */}
          <div className="fixed inset-0 z-40 animate-fade-in" onClick={close} />
          <nav className="absolute right-2 top-14 z-50 w-64 max-w-[85vw] rounded-lg border border-border/60 bg-card p-1.5 shadow-md animate-slide-up">
            {email && (
              <div className="flex items-center gap-2 px-2.5 py-2 mb-1 border-b border-border font-mono text-[11px] text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                <span className="truncate">{email}</span>
              </div>
            )}

            {NAV_ITEMS.map((item) => {
              const active = item.isActive(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-border/50"
                  )}
                >
                  <Icon size={15} className="shrink-0" />
                  {item.label}
                </Link>
              );
            })}

            <div className="my-1 border-t border-border" />

            <Link
              href="/recent"
              onClick={close}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-colors",
                pathname.startsWith("/recent")
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-border/50"
              )}
            >
              <Search size={15} className="shrink-0" />
              Recent chats
            </Link>
            <Link
              href="/settings"
              onClick={close}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-border/50"
              )}
            >
              <Settings size={15} className="shrink-0" />
              Settings
            </Link>
            <button
              onClick={() => {
                close();
                logout();
              }}
              className="flex w-full items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <LogOut size={15} className="shrink-0" />
              Log out
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

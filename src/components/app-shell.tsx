"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, MessageSquare, Library, Database, Bot } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { STAT_PAPERS_INDEXED } from "@/lib/data";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/chat-assist-ui", label: "Chat (assistant-ui)", icon: Bot },
  { href: "/library", label: "Library", icon: Library },
  { href: "/make-science", label: "Index", icon: Database },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      {/* Icon rail (desktop) */}
      <aside className="hidden md:flex flex-col items-center w-14 shrink-0 border-r border-border/60 bg-sidebar py-4 gap-1">
        <div className="w-8 h-8 rounded-md bg-foreground flex items-center justify-center mb-4">
          <Sparkles size={15} className="text-accent" strokeWidth={2.2} />
        </div>
        {NAV_ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
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
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-background shrink-0">
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
          <nav className="flex md:hidden bg-sidebar rounded-lg p-0.5 border border-border/60">
            {NAV_ITEMS.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1.5 rounded-md font-mono text-[11px] transition-colors",
                    active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  <Icon size={12} /> {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              indexed &amp; grounded locally
            </div>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
}

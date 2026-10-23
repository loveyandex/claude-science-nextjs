"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";

const STORAGE_KEY = "chat:rtl";

type RtlContextValue = {
  rtl: boolean;
  setRtl: (value: boolean) => void;
};

const RtlContext = createContext<RtlContextValue | null>(null);

export function RtlProvider({ children }: { children: React.ReactNode }) {
  const [rtl, setRtlState] = useState(false);

  useEffect(() => {
    try {
      setRtlState(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
  }, []);

  const setRtl = (value: boolean) => {
    setRtlState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {}
  };

  return <RtlContext.Provider value={{ rtl, setRtl }}>{children}</RtlContext.Provider>;
}

export function useRtl() {
  const ctx = useContext(RtlContext);
  if (!ctx) throw new Error("useRtl must be used inside RtlProvider");
  return ctx;
}

export function isChatRoute(pathname: string) {
  return (
    pathname === "/chat" ||
    pathname.startsWith("/c/") ||
    pathname === "/chat-assist-ui" ||
    pathname.startsWith("/c-assist-ui/")
  );
}

export function RtlToggle() {
  const { rtl, setRtl } = useRtl();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-5 w-14" />;

  return (
    <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground cursor-pointer shrink-0">
      <span className={rtl ? "text-accent" : undefined}>RTL</span>
      <Switch checked={rtl} onCheckedChange={setRtl} aria-label="Toggle right-to-left text" />
    </label>
  );
}

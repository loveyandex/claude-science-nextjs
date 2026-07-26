"use client";

import { useState } from "react";
import { ScanEye, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Gemma4SettingsPanel } from "@/components/settings/gemma4-settings-panel";

// Only one section exists today (gemma4 indexing), but this is built as a
// real sidebar-of-sections rather than a single panel so future settings
// (e.g. other pipelines/providers) have somewhere to go without a rework.
const SECTIONS = [
  { id: "indexing-by-gemma", label: "Indexing · gemma4", icon: ScanEye },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>("indexing-by-gemma");

  return (
    <div className="h-full min-h-0 flex">
      <aside className="w-52 shrink-0 border-r border-border py-6 px-3 hidden sm:block">
        <div className="flex items-center gap-2 px-2 mb-4">
          <SettingsIcon size={15} className="text-accent" />
          <h1 className="font-display font-semibold text-[14px]">Settings</h1>
        </div>
        <nav className="space-y-0.5">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = active === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setActive(section.id)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                )}
              >
                <Icon size={14} />
                {section.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="max-w-2xl mx-auto w-full px-4 md:px-8 py-6">
          {active === "indexing-by-gemma" && <Gemma4SettingsPanel />}
        </div>
      </div>
    </div>
  );
}

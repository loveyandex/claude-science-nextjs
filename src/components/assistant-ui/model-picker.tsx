"use client";

import { BrainCircuit } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelSelection } from "@/components/assistant-ui/model-context";

export function ModelPicker() {
  const { models, model, setModel, thinking, setThinking } = useModelSelection();

  return (
    <div className="flex items-center gap-1">
      <Select value={model} onValueChange={setModel}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id} description={m.description}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={() => setThinking(!thinking)}
        title="Thinking mode — ask the model to show its reasoning (Gemini only for now)"
        className={`flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] transition-colors ${
          thinking
            ? "bg-accent/15 text-accent"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        }`}
      >
        <BrainCircuit size={12} />
        thinking
      </button>
    </div>
  );
}

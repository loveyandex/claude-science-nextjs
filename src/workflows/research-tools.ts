import { tool, type ToolSet } from "ai";
import { TOOL_DEFS, type ToolContext, type ToolName } from "@/lib/research/tool-defs";
import { runToolStep } from "@/workflows/research-steps";

/** Tool set for a WorkflowAgent: schemas from TOOL_DEFS, every call a durable step. */
export function buildTools(names: ToolName[], ctx: ToolContext): ToolSet {
  return Object.fromEntries(
    names.map((name) => [
      name,
      tool({
        description: TOOL_DEFS[name].description,
        inputSchema: TOOL_DEFS[name].inputSchema as never,
        execute: (input: Record<string, unknown>) => runToolStep(name, input, ctx),
      }),
    ])
  );
}

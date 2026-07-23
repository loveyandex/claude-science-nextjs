import { cn } from "@/lib/utils";

/**
 * Content-shaped loading placeholder. Hand-rolled rather than pulled from
 * Radix Themes (see .agents/skills/frontend-ui-conventions/SKILL.md) but
 * follows the same idea: a shimmering block the same shape as the content
 * it stands in for, not a generic spinner.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-foreground/[0.06]", className)}
      {...props}
    />
  );
}

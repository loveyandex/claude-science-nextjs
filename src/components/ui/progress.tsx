import { cn } from "@/lib/utils";

/**
 * Determinate/indeterminate progress bar.
 *
 * Hand-rolled to match this project's tokens rather than pulled from
 * Radix Themes, same as Skeleton (see
 * .agents/skills/frontend-ui-conventions/SKILL.md). `value === null`
 * renders the indeterminate sheen — used for a page whose chunk count
 * isn't known yet, where a 0% bar would wrongly read as "stuck".
 */
export function Progress({
  value,
  className,
  barClassName,
  label,
}: {
  /** 0-100, or null for indeterminate. */
  value: number | null;
  className?: string;
  barClassName?: string;
  label?: string;
}) {
  const isIndeterminate = value === null;
  const clamped = isIndeterminate ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isIndeterminate ? undefined : Math.round(clamped)}
      aria-label={label}
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]",
        className
      )}
    >
      {isIndeterminate ? (
        <div className="absolute inset-y-0 w-1/3 animate-shimmer rounded-full bg-accent/50" />
      ) : (
        <div
          className={cn("h-full rounded-full bg-accent transition-all duration-500 ease-out", barClassName)}
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
}

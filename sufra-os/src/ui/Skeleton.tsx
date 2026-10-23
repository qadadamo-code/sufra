import { cn } from "@/lib/cn";

export function Skeleton({ className, rounded = "rounded-lg" }: { className?: string; rounded?: string }) {
  return (
    <span
      className={cn("block animate-shimmer bg-[length:200%_100%]", rounded, className)}
      style={{ backgroundImage: "linear-gradient(90deg, var(--sf-surface-3) 0%, var(--sf-surface-2) 50%, var(--sf-surface-3) 100%)" }}
      aria-hidden
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

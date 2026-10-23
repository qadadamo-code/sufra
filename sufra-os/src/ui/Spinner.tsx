import { cn } from "@/lib/cn";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} aria-label={label} className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-e-transparent align-[-2px]", className)} />
  );
}

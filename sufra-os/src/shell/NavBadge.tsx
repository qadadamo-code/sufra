import { AnimatePresence, motion } from "motion/react";
import type { ModuleDef } from "@/modules/types";
import { cn } from "@/lib/cn";

function Count({ use, className }: { use: () => number | null; className?: string }) {
  const n = use();
  return (
    <AnimatePresence>
      {n ? (
        <motion.span
          key="b"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          className={cn("num grid h-5 min-w-5 place-items-center rounded-full bg-brass px-1.5 text-[11px] font-bold text-brass-ink", className)}
        >
          {n > 99 ? "99+" : n}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

/** Renders a module's live badge (hook is stable per module, so calling it here is safe). */
export function NavBadge({ module, className }: { module: ModuleDef; className?: string }) {
  if (!module.nav?.useBadge) return null;
  return <Count use={module.nav.useBadge} className={className} />;
}

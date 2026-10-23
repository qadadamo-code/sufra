import { cn } from "@/lib/cn";

export function initials(name: string) {
  const parts = name
    .replace(/^(ال)?(شيف|عم|أستاذ|د\.)\s+/u, "")
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .map((w) => w.replace(/^(?:ال|عبد\s?ال)(?=\p{L}{2})/u, ""));
  if (!parts.length) return "؟";
  const first = [...parts[0]][0] ?? "";
  const second = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? "") : "";
  return (first + second).toUpperCase();
}

const SIZES = { xs: "size-6 text-[10px]", sm: "size-8 text-[12px]", md: "size-10 text-[14px]", lg: "size-14 text-[19px]", xl: "size-20 text-[26px]" };

export function Avatar({ name, color, size = "md", className, ring, status }: { name: string; color?: string; size?: keyof typeof SIZES; className?: string; ring?: boolean; status?: "online" | "away" | null }) {
  const c = color ?? "var(--sf-primary)";
  return (
    <span
      className={cn("relative inline-grid shrink-0 select-none place-items-center rounded-full font-display font-semibold leading-none text-white", SIZES[size], ring && "ring-2 ring-[var(--sf-surface)]", className)}
      style={{ background: `linear-gradient(145deg, color-mix(in srgb, ${c} 82%, white), ${c})` }}
      aria-hidden
    >
      {initials(name)}
      {status ? <span className={cn("absolute -bottom-0.5 -end-0.5 size-3 rounded-full ring-2 ring-[var(--sf-surface)]", status === "online" ? "bg-ok" : "bg-warn")} /> : null}
    </span>
  );
}

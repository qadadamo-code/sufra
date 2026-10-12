import { useState } from "react";
import { imgUrl, tintFor } from "@/lib/media";
import { cn } from "@/lib/utils";

/** Local photo with a graceful fallback: a tinted tile with the dish/venue initial. */
export function Photo({ k, label, className, imgClassName, eager = false }: { k: string | null | undefined; label: string; className?: string; imgClassName?: string; eager?: boolean }) {
  const src = imgUrl(k);
  const [broken, setBroken] = useState(false);
  const tint = tintFor(k || label);
  const initial = (label || "؟").trim().replace(/^(ال)/, "").charAt(0);
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: `color-mix(in srgb, ${tint} 22%, var(--card))` }}>
      {src && !broken ? (
        <img src={src} alt={label} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBroken(true)} className={cn("absolute inset-0 size-full object-cover", imgClassName)} />
      ) : (
        <div className="absolute inset-0 grid place-items-center" aria-label={label} role="img">
          <span className="font-display text-4xl font-bold" style={{ color: tint, opacity: 0.85 }}>
            {initial}
          </span>
          <svg className="absolute inset-0 size-full opacity-[0.12]" aria-hidden>
            <defs>
              <pattern id={`p-${tint.slice(1)}`} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="16" stroke={tint} strokeWidth="2" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#p-${tint.slice(1)})`} />
          </svg>
        </div>
      )}
    </div>
  );
}

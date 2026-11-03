/** The restaurant's own promos on its QR menu / online ordering page: a swipeable strip of offer cards. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Gift } from "lucide-react";
import { useRepo } from "@/data/hooks";
import type { BannerPlacement, OrderMode, PromoBanner } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { PromoPublic } from "./api";

export function BannerCard({ b, onClick, compact }: { b: Pick<PromoBanner, "title" | "body" | "badge" | "color" | "imageUrl">; onClick?: () => void; compact?: boolean }) {
  const { loc } = useT();
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn("relative flex w-full shrink-0 snap-start items-center gap-3 overflow-hidden rounded-[20px] p-4 text-start text-white shadow-sf", compact ? "min-h-20" : "min-h-24")}
      style={{ background: `linear-gradient(135deg, ${b.color}, color-mix(in srgb, ${b.color} 55%, black))` }}
    >
      <span aria-hidden className="pointer-events-none absolute -end-6 -top-8 size-28 rounded-full bg-white/10" />
      <span aria-hidden className="pointer-events-none absolute -bottom-10 end-14 size-20 rounded-full bg-white/10" />
      <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-white/18 text-[20px] font-bold backdrop-blur-sm">{b.badge || "★"}</span>
      <span className="relative min-w-0">
        <span className="block text-[16px] font-bold leading-tight">{loc(b.title)}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-white/85">{loc(b.body)}</span>
      </span>
    </Tag>
  );
}

/** Banners for a placement; tapping one with an item opens it (onItem), impressions/clicks are counted. */
export function PromoStrip({ slug, placement, mode, onItem, className, showClub = true }: { slug: string; placement: BannerPlacement; mode: OrderMode; onItem?: (itemId: string) => void; className?: string; showClub?: boolean }) {
  const repo = useRepo();
  const api = useMemo(() => new PromoPublic(repo), [repo]);
  const { L } = useT();
  const [banners, setBanners] = useState<PromoBanner[]>([]);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    let off = false;
    api.promos(slug, placement, mode).then((r) => !off && setBanners(r.banners), () => undefined);
    return () => {
      off = true;
    };
  }, [api, slug, placement, mode]);
  useEffect(() => {
    for (const b of banners) if (!seen.current.has(b.id)) {
      seen.current.add(b.id);
      void api.track(b.id, "impression");
    }
  }, [banners, api]);
  if (!banners.length) return null;
  return (
    <section aria-label={L("العروض", "Offers")} className={cn("grid gap-2", className)}>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar [&>*]:w-[86%] sm:[&>*]:w-[340px]">
        {banners.map((b) => (
          <BannerCard key={b.id} b={b} onClick={() => {
            void api.track(b.id, "click");
            if (b.itemId && onItem) onItem(b.itemId);
          }} />
        ))}
      </div>
      {showClub ? (
        <Link to={`/r/${slug}/me`} className="inline-flex items-center gap-1.5 justify-self-start text-[13px] font-semibold text-primary">
          <Gift className="size-4" />
          {L("نقاطك وكارت الولاء", "Your points & loyalty card")}
          <ChevronLeft className="size-4 ltr:rotate-180" />
        </Link>
      ) : null}
    </section>
  );
}

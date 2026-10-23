import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Flame, Leaf, Plus, Search, Sparkles, Star, X } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { matches } from "@/lib/arabic";
import { Badge, EmptyState, Money, useReduced } from "@/ui";
import { itemImage } from "../data/images";
import type { MenuItemView } from "../cart";
import { useGuest } from "./context";
import { Photo } from "./bits";

const TAGS: Record<string, { icon: React.ReactNode; ar: string; en: string; tone: "brass" | "ok" | "danger" | "info" }> = {
  popular: { icon: <Star className="fill-current" />, ar: "الأكثر طلبًا", en: "Popular", tone: "brass" },
  chef: { icon: <Sparkles />, ar: "اختيار الشيف", en: "Chef's pick", tone: "info" },
  veg: { icon: <Leaf />, ar: "نباتي", en: "Veggie", tone: "ok" },
  spicy: { icon: <Flame />, ar: "حرّاق", en: "Spicy", tone: "danger" },
  new: { icon: <Sparkles />, ar: "جديد", en: "New", tone: "info" },
};

export function TagChips({ tags, max = 2 }: { tags: string[]; max?: number }) {
  const { L } = useT();
  const shown = tags.filter((t) => TAGS[t]).slice(0, max);
  if (!shown.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Badge key={t} size="sm" tone={TAGS[t].tone} icon={TAGS[t].icon}>
          {L(TAGS[t].ar, TAGS[t].en)}
        </Badge>
      ))}
    </span>
  );
}

/** Search + sticky category bar with scroll-spy + sections of item cards. */
export function MenuBrowser({ onOpen, topOffset = 0, header }: { onOpen: (item: MenuItemView) => void; topOffset?: number; header?: React.ReactNode }) {
  const { menu, cart } = useGuest();
  const { t, L, loc } = useT();
  const reduced = useReduced();
  const [q, setQ] = useState("");
  const [active, setActive] = useState<string | null>(menu.categories[0]?.id ?? null);
  const sections = useRef(new Map<string, HTMLElement>());
  const bar = useRef<HTMLDivElement>(null);
  const lock = useRef(0);

  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [cart]);

  const filtered = useMemo(() => (q.trim() ? menu.items.filter((i) => matches(`${i.name.ar} ${i.name.en} ${i.description.ar} ${i.description.en}`, q)) : menu.items), [menu.items, q]);
  const byCat = useMemo(() => {
    const m = new Map<string, MenuItemView[]>();
    for (const i of filtered) m.set(i.categoryId, [...(m.get(i.categoryId) ?? []), i]);
    return m;
  }, [filtered]);
  const popular = useMemo(() => menu.items.filter((i) => i.available && i.tags.includes("popular") && itemImage(i)).slice(0, 8), [menu.items]);
  const cats = menu.categories.filter((c) => byCat.has(c.id));

  // scroll-spy
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (Date.now() < lock.current) return;
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive((vis.target as HTMLElement).dataset.cat ?? null);
      },
      { rootMargin: `-${topOffset + 70}px 0px -60% 0px` },
    );
    sections.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cats.length, topOffset, q]);

  // keep the active chip visible
  useEffect(() => {
    const chip = bar.current?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    chip?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", inline: "center", block: "nearest" });
  }, [active, reduced]);

  const jump = (id: string) => {
    setActive(id);
    lock.current = Date.now() + 900;
    const el = sections.current.get(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - topOffset - 64, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div>
      <div className="sticky z-20 border-b border-line/70 bg-bg/92 backdrop-blur-lg supports-[backdrop-filter]:bg-bg/80" style={{ top: topOffset }}>
        <div className="mx-auto max-w-2xl px-4 pt-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-[18px] text-muted" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("دوّر على أكلة…", "Search dishes…")}
              aria-label={L("بحث", "Search")}
              className="h-11 w-full rounded-full border border-line bg-surface ps-10 pe-10 text-[15px] outline-none transition placeholder:text-faint focus:border-primary focus:shadow-[var(--sf-glow)] [&::-webkit-search-cancel-button]:hidden"
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label={L("امسح", "Clear")} className="absolute inset-y-0 end-1.5 my-auto grid size-8 place-items-center rounded-full text-muted hover:bg-surface-3">
                <X className="size-4" />
              </button>
            ) : null}
          </label>
        </div>
        <div ref={bar} className="mx-auto flex max-w-2xl gap-1.5 overflow-x-auto px-4 py-2.5 no-scrollbar" role="tablist" aria-label={L("الأقسام", "Categories")}>
          {cats.map((c) => (
            <button
              key={c.id}
              data-chip={c.id}
              role="tab"
              aria-selected={active === c.id}
              type="button"
              onClick={() => jump(c.id)}
              className={cn("relative h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold transition-colors", active === c.id ? "text-primary-ink" : "text-ink-2 hover:bg-surface-3")}
            >
              {active === c.id ? <motion.span layoutId="guest-cat" className="absolute inset-0 rounded-full bg-primary" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }} /> : null}
              <span className="relative">{loc(c.name)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-5">
        {header}
        {!q && popular.length ? (
          <section className="mb-8" aria-label={L("الأكثر طلبًا", "Most ordered")}>
            <h2 className="mb-3 flex items-center gap-2 text-[21px]">
              <Star className="size-5 fill-brass text-brass" aria-hidden />
              {L("الأكثر طلبًا", "Most ordered")}
            </h2>
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
              {popular.map((i) => (
                <button key={i.id} type="button" onClick={() => onOpen(i)} className="group w-40 shrink-0 snap-start text-start">
                  <Photo src={itemImage(i)} alt={loc(i.name)} className="aspect-[4/3] w-full rounded-2xl shadow-sf-sm">
                    {inCart.get(i.id) ? <span className="num absolute top-2 start-2 grid size-7 place-items-center rounded-full bg-primary text-[13px] font-bold text-primary-ink shadow">{inCart.get(i.id)}</span> : null}
                  </Photo>
                  <p className="mt-2 line-clamp-1 text-[14.5px] font-bold">{loc(i.name)}</p>
                  <Money value={i.price} compact className="text-[13.5px] text-muted" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {!cats.length ? <EmptyState compact icon={<Search />} title={L("مفيش أكلة بالاسم ده", "No dishes match")} body={L("جرّب كلمة تانية", "Try another word")} /> : null}

        <div className="grid gap-9">
          {cats.map((c) => (
            <section
              key={c.id}
              data-cat={c.id}
              ref={(el) => {
                if (el) sections.current.set(c.id, el);
                else sections.current.delete(c.id);
              }}
              aria-labelledby={`cat-${c.id}`}
            >
              <h2 id={`cat-${c.id}`} className="mb-3 text-[22px]">
                {loc(c.name)}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 sm:gap-3.5">
                {(byCat.get(c.id) ?? []).map((i) => (
                  <li key={i.id}>
                    <ItemCard item={i} qty={inCart.get(i.id) ?? 0} onOpen={onOpen} soldOut={t("guest.soldOut")} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export const ItemCard = memo(function ItemCard({ item, qty, onOpen, soldOut }: { item: MenuItemView; qty: number; onOpen: (i: MenuItemView) => void; soldOut: string }) {
  const { loc, L } = useT();
  const src = itemImage(item);
  return (
    <button
      type="button"
      disabled={!item.available}
      onClick={() => onOpen(item)}
      className={cn(
        "group flex h-full w-full items-stretch gap-3 rounded-[22px] border border-line bg-surface p-2.5 text-start shadow-sf-sm transition-[transform,box-shadow,border-color] duration-200 active:scale-[0.985] hover:border-line-strong hover:shadow-sf disabled:active:scale-100",
        qty > 0 && "border-primary/45 ring-1 ring-primary/25",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col py-1 ps-1.5">
        <p className="text-[15.5px] font-bold leading-snug">{loc(item.name)}</p>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{loc(item.description)}</p>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {item.available ? <Money value={item.price} compact className="text-[15px] font-bold" /> : <Badge tone="danger" size="sm">{soldOut}</Badge>}
          <TagChips tags={item.tags} max={1} />
        </div>
      </div>
      <Photo src={src} alt={loc(item.name)} className={cn("aspect-square w-[104px] shrink-0 self-center rounded-2xl sm:w-[112px]", !item.available && "grayscale")}>
        {item.available ? (
          <span
            aria-label={qty ? L(`في السلة ${qty}`, `${qty} in cart`) : L("أضف", "Add")}
            className={cn(
              "absolute bottom-1.5 end-1.5 grid size-9 place-items-center rounded-full shadow-sf transition-transform group-active:scale-90",
              qty ? "num bg-primary text-[14px] font-bold text-primary-ink" : "bg-surface/95 text-primary backdrop-blur",
            )}
          >
            {qty ? qty : <Plus className="size-5" strokeWidth={2.5} />}
          </span>
        ) : null}
      </Photo>
    </button>
  );
});

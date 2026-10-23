/** Category rail + search + item grid. Tap = add (or open modifiers), long-press/right-click = always open the sheet. */
import { forwardRef, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, Flame, Leaf, Search, Sparkles, Star, X } from "lucide-react";
import type { MenuCategory, MenuItem } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { spring, useReduced } from "@/ui";
import { catIcon, Chip } from "./bits";

export interface MenuPanelProps {
  cats: MenuCategory[];
  items: MenuItem[];
  counts: Map<string, number>;
  onPick: (item: MenuItem, opts: { forceSheet: boolean }) => void;
}

export const MenuPanel = forwardRef<HTMLInputElement, MenuPanelProps>(function MenuPanel({ cats, items, counts, onPick }, searchRef) {
  const { L, loc, lang } = useT();
  const reduced = useReduced();
  const [cat, setCat] = useState<string | "all">("all");
  const [q, setQ] = useState("");
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const shown = useMemo(() => {
    const list = q.trim() ? items.filter((i) => matches(`${i.name.ar} ${i.name.en} ${i.sku ?? ""} ${catById.get(i.categoryId)?.name.ar ?? ""}`, q)) : cat === "all" ? items : items.filter((i) => i.categoryId === cat);
    return cat === "all" && !q.trim() ? [...list].sort((a, b) => (catById.get(a.categoryId)?.sort ?? 0) - (catById.get(b.categoryId)?.sort ?? 0) || a.sort - b.sort) : list;
  }, [items, cat, q, catById]);
  const inCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const [itemId, n] of counts) {
      const c = items.find((i) => i.id === itemId)?.categoryId;
      if (c) m.set(c, (m.get(c) ?? 0) + n);
    }
    return m;
  }, [counts, items]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={L("المنيو", "Menu")}>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 @3xl:px-4">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                onPick(shown[0], { forceSheet: false });
                setQ("");
              }
              if (e.key === "Escape") (setQ(""), (e.target as HTMLInputElement).blur());
            }}
            placeholder={L("دوّر على صنف أو كود… (S)", "Search item or code… (S)")}
            aria-label={L("بحث في المنيو", "Search menu")}
            className="h-12 w-full rounded-2xl border border-line bg-surface ps-11 pe-10 text-[15.5px] shadow-sf-sm outline-none placeholder:text-faint focus:border-primary focus:shadow-[var(--sf-glow)]"
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} className="absolute end-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-3" aria-label={L("امسح", "Clear")}>
              <X className="size-4" />
            </button>
          ) : null}
        </label>
      </div>
      <div className="flex gap-2 overflow-x-auto px-3 pb-2 no-scrollbar @3xl:px-4" role="tablist" aria-label={L("الأقسام", "Categories")}>
        <Chip active={cat === "all" && !q} onClick={() => (setCat("all"), setQ(""))}>
          {L("الكل", "All")}
        </Chip>
        {cats.map((c) => {
          const Icon = catIcon(c.icon);
          return (
            <Chip key={c.id} active={cat === c.id && !q} color={c.color} onClick={() => (setCat(c.id), setQ(""))} count={inCat.get(c.id) ?? null}>
              <Icon aria-hidden />
              {loc(c.name)}
            </Chip>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4 thin-scrollbar @3xl:px-4">
        {shown.length === 0 ? (
          <p className="py-16 text-center text-muted">{L("مفيش أصناف بالاسم ده", "No items match")}</p>
        ) : (
          <motion.ul layout={!reduced} className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3 @3xl:grid-cols-4 @6xl:grid-cols-5" aria-label={L("الأصناف", "Items")}>
            <AnimatePresence initial={false}>
              {shown.map((it) => (
                <ItemTile key={it.id} item={it} cat={catById.get(it.categoryId)} count={counts.get(it.id) ?? 0} onPick={onPick} lang={lang} />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>
    </section>
  );
});

function ItemTile({ item, cat, count, onPick, lang }: { item: MenuItem; cat?: MenuCategory; count: number; onPick: MenuPanelProps["onPick"]; lang: "ar" | "en" }) {
  const { L, loc } = useT();
  const reduced = useReduced();
  const Icon = catIcon(cat?.icon);
  const color = cat?.color ?? "var(--sf-primary)";
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  const off = !item.available;
  const start = () => {
    long.current = false;
    press.current = setTimeout(() => {
      long.current = true;
      onPick(item, { forceSheet: true });
    }, 480);
  };
  const end = () => press.current && clearTimeout(press.current);
  return (
    <motion.li layout={!reduced} initial={reduced ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={spring.snappy}>
      <motion.button
        type="button"
        disabled={off}
        whileTap={reduced || off ? undefined : { scale: 0.96 }}
        transition={spring.snappy}
        onPointerDown={start}
        onPointerUp={end}
        onPointerLeave={end}
        onClick={() => {
          if (long.current) return;
          onPick(item, { forceSheet: false });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          end();
          onPick(item, { forceSheet: true });
        }}
        className={cn(
          "group relative flex h-full min-h-[112px] w-full flex-col overflow-hidden rounded-[18px] border border-line bg-surface p-3 text-start shadow-sf-sm transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-sf focus-visible:outline-2",
          off && "opacity-55",
          count > 0 && "border-transparent ring-2",
        )}
        style={{ ...(count > 0 ? { ["--tw-ring-color" as string]: color } : {}), backgroundImage: item.imageUrl ? undefined : `linear-gradient(160deg, color-mix(in srgb, ${color} 13%, transparent), transparent 62%)` }}
        aria-label={`${loc(item.name)} ${formatMoney(item.price, { lang })}${off ? ` — ${L("خلصان", "sold out")}` : ""}`}
      >
        {item.imageUrl ? <img src={item.imageUrl} alt="" className="absolute inset-0 size-full object-cover opacity-25" /> : null}
        <span className="relative flex items-start justify-between gap-2">
          <span className="grid size-8 place-items-center rounded-xl text-white shadow-sf-sm" style={{ background: color }}>
            <Icon className="size-[17px]" aria-hidden />
          </span>
          <span className={cn("flex gap-1 text-brass transition-opacity [&_svg]:size-4", count > 0 && "opacity-0")}>
            {item.tags.includes("popular") ? <Star aria-label={L("الأكثر طلبًا", "Popular")} className="fill-current" /> : null}
            {item.tags.includes("chef") ? <Sparkles aria-label={L("اختيار الشيف", "Chef's pick")} /> : null}
            {item.tags.includes("spicy") ? <Flame aria-label={L("حرّاق", "Spicy")} className="text-danger" /> : null}
            {item.tags.includes("veg") ? <Leaf aria-label={L("نباتي", "Vegetarian")} className="text-ok" /> : null}
          </span>
        </span>
        <span className="relative mt-2 line-clamp-2 text-[15px] font-semibold leading-snug">{loc(item.name)}</span>
        <span className="relative mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="num text-[14.5px] font-semibold text-ink-2" dir="ltr">
            {formatMoney(item.price, { lang, compact: true, bare: true })}
          </span>
          {item.modifierGroupIds.length ? <span className="rounded-full bg-surface-3 px-2 text-[11px] font-semibold text-muted">{L("اختيارات", "options")}</span> : null}
        </span>
        {off ? (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-danger py-0.5 text-[12px] font-bold text-white">
            <Ban className="size-3.5" /> {L("خلصان", "86'd")}
          </span>
        ) : null}
        <AnimatePresence>
          {count > 0 ? (
            <motion.span
              key={count}
              initial={reduced ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={spring.snappy}
              className="num absolute top-2 end-2 grid min-w-7 place-items-center rounded-full px-1.5 text-[13px] font-bold leading-7 text-white shadow-sf"
              style={{ background: color }}
            >
              {count}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.button>
    </motion.li>
  );
}

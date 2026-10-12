/**
 * Instant search box: places, dishes, areas and cuisines as you type (Arabic-normalised, typo-tolerant),
 * recent searches and trending when empty. ARIA combobox with keyboard navigation.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Clock, Flame, MapPin, Search, Store, Utensils, X } from "lucide-react";
import { areaName, cuisineName } from "@/lib/data";
import { fmtKm } from "@/lib/geo";
import { useLang } from "@/lib/i18n";
import { navigate } from "@/lib/router";
import { clearSearches, pushSearch, searchAll, trending, useRecentSearches } from "@/lib/search";
import { useHome } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Photo } from "./Photo";

type Opt = { key: string; label: string; sub?: string; icon: "place" | "dish" | "area" | "cuisine" | "recent" | "trend"; img?: string; run: () => void };

export function SmartSearch({
  value,
  onChange,
  onSubmit,
  onArea,
  onCuisine,
  placeholder,
  className,
  inputClassName,
  id,
  submitLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (q: string) => void;
  /** in Explore, picking an area/cuisine applies a filter instead of navigating */
  onArea?: (id: string) => void;
  onCuisine?: (id: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  id?: string;
  submitLabel?: string;
}) {
  const { L, lang } = useLang();
  const { home } = useHome();
  const recent = useRecentSearches();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [debounced, setDebounced] = useState(value);
  const box = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const listId = `ss-${uid}`;

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), 90);
    return () => window.clearTimeout(t);
  }, [value]);

  const submit = (q: string) => {
    pushSearch(q);
    setOpen(false);
    onSubmit(q);
  };

  const groups = useMemo(() => {
    const out: { title: string; opts: Opt[] }[] = [];
    if (!debounced.trim()) {
      if (recent.length) out.push({ title: L("آخر حاجات دورت عليها", "Recent searches"), opts: recent.slice(0, 5).map((q) => ({ key: "r" + q, label: q, icon: "recent", run: () => { onChange(q); submit(q); } })) });
      out.push({ title: L("الناس بتدور على", "Trending now"), opts: trending(new Date(), lang).slice(0, 6).map((q) => ({ key: "t" + q, label: q, icon: "trend", run: () => { onChange(q); submit(q); } })) });
      return out;
    }
    const res = searchAll(debounced, { origin: home, limit: 5 });
    if (res.places.length)
      out.push({
        title: L("أماكن", "Places"),
        opts: res.places.map((p) => ({ key: "p" + p.r.id, label: p.r[lang], sub: `${cuisineName(p.r.cuisine, lang)} · ${areaName(p.r.area, lang)}${p.km != null ? " · " + fmtKm(p.km, lang) : ""}`, icon: "place", img: p.r.cover, run: () => { pushSearch(debounced); setOpen(false); navigate(`/r/${p.r.slug}`); } })),
      });
    if (res.dishes.length)
      out.push({
        title: L("أكلات", "Dishes"),
        opts: res.dishes.map((d) => ({ key: "d" + d.item.id, label: d.item[lang], sub: L(`في ${d.r.ar}`, `at ${d.r.en}`), icon: "dish", img: d.item.img, run: () => { pushSearch(debounced); setOpen(false); navigate(`/r/${d.r.slug}`); } })),
      });
    if (res.areas.length)
      out.push({
        title: L("مناطق", "Areas"),
        opts: res.areas.map((a) => ({ key: "a" + a.a.id, label: a.a[lang], sub: L(`${a.count} مكان`, `${a.count} places`), icon: "area", run: () => { setOpen(false); onChange(""); if (onArea) onArea(a.a.id); else navigate(`/explore?area=${a.a.id}`); } })),
      });
    if (res.cuisines.length)
      out.push({
        title: L("أنواع أكل", "Cuisines"),
        opts: res.cuisines.map((c) => ({ key: "c" + c.id, label: cuisineName(c.id, lang), sub: L(`${c.count} مكان`, `${c.count} places`), icon: "cuisine", run: () => { setOpen(false); onChange(""); if (onCuisine) onCuisine(c.id); else navigate(`/explore?cuisine=${c.id}`); } })),
      });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, recent, lang, home]);
  const flat = groups.flatMap((g) => g.opts);

  useEffect(() => setActive(-1), [debounced]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Enter" && active >= 0 && flat[active]) {
      e.preventDefault();
      flat[active].run();
    }
  };

  const Icon = ({ k }: { k: Opt["icon"] }) => {
    const C = k === "place" ? Store : k === "dish" ? Utensils : k === "area" ? MapPin : k === "recent" ? Clock : k === "trend" ? Flame : Utensils;
    return <C className={cn("size-4 shrink-0", k === "trend" ? "text-brass" : "text-muted-foreground")} aria-hidden />;
  };

  let n = -1;
  return (
    <div ref={box} className={cn("relative", className)}>
      <form
        role="search"
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(value.trim());
        }}
      >
        <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor={id ?? `q-${uid}`} className="sr-only">
          {L("دوّر على مطعم أو أكلة أو منطقة", "Search a restaurant, dish or area")}
        </label>
        <input
          id={id ?? `q-${uid}`}
          type="search"
          role="combobox"
          aria-expanded={open && flat.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder ?? L("مطعم، أكلة، أو منطقة…", "Restaurant, dish or area…")}
          className={cn("min-w-0 flex-1 bg-transparent ps-11 text-[16px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden", inputClassName)}
        />
        {value ? (
          <button type="button" onClick={() => onChange("")} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-2" aria-label={L("امسح", "Clear")}>
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
        {submitLabel ? (
          <button type="submit" className="sf-btn sf-btn-primary h-11 shrink-0 px-5 sm:px-7">
            {submitLabel}
          </button>
        ) : null}
      </form>
      {open && flat.length ? (
        <div id={listId} role="listbox" aria-label={L("اقتراحات", "Suggestions")} className="absolute inset-x-0 top-[calc(100%+8px)] z-50 max-h-[min(60svh,460px)] overflow-y-auto overscroll-contain rounded-2xl border bg-card p-2 text-start shadow-sf">
          {groups.map((g) => (
            <div key={g.title} role="group" aria-label={g.title} className="py-1">
              <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
                {g.opts[0]?.icon === "recent" ? (
                  <button type="button" className="normal-case text-primary hover:underline" onClick={clearSearches}>
                    {L("امسح", "Clear")}
                  </button>
                ) : null}
              </div>
              {g.opts.map((o) => {
                n++;
                const idx = n;
                return (
                  <div
                    key={o.key}
                    id={`${listId}-${idx}`}
                    role="option"
                    aria-selected={active === idx}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={o.run}
                    onPointerEnter={() => setActive(idx)}
                    className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2", active === idx && "bg-surface-2")}
                  >
                    {o.img ? <Photo k={o.img} label={o.label} className="size-9 shrink-0 rounded-lg" /> : <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2"><Icon k={o.icon} /></span>}
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">{o.label}</span>
                      {o.sub ? <span className="block truncate text-xs text-muted-foreground">{o.sub}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ActivityHeatmap — rebuilt from the owner's spec; supporting tokens/CSS written for Sufra (brass accent).
import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { blur, duration, ease, spring } from "./activity-heatmap-utils/motion-tokens";
import { buildModel, parseUTC, type HeatDay } from "./activity-heatmap-utils/model";
import s from "./activity-heatmap.module.css";
import "./activity-heatmap-vars.css";

export type { HeatDay };

/** Each digit rolls up (bigger) or down (smaller) out of a soft blur; the width springs. */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const prev = React.useRef(value);
  const dir = value >= prev.current ? 1 : -1;
  React.useEffect(() => {
    prev.current = value;
  }, [value]);
  const digits = String(value).split("");
  return (
    <motion.span layout={!reduced} transition={spring.morph} className={cn(s.rolling, className)} aria-label={String(value)}>
      {digits.map((d, i) => (
        <span key={digits.length - i} className={s.digit} aria-hidden>
          <AnimatePresence initial={false} mode="popLayout" custom={dir}>
            <motion.span
              key={d}
              style={{ display: "inline-block" }}
              initial={reduced ? { opacity: 0 } : { y: `${dir * 100}%`, opacity: 0, filter: `blur(${blur.soft}px)` }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
              exit={reduced ? { opacity: 0 } : { y: `${-dir * 100}%`, opacity: 0, filter: `blur(${blur.soft}px)` }}
              transition={reduced ? { duration: 0 } : { duration: 0.35, ease: ease.enter }}
            >
              {d}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </motion.span>
  );
}

/** Words crossfade, rising from a soft blur. */
export function RiseText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  return (
    <span className={s.rise}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: `blur(${blur.soft}px)` }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, filter: `blur(${blur.subtle}px)` }}
          transition={reduced ? { duration: 0 } : { duration: 0.4, ease: ease.standard }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function ActivityHeatmap({
  days,
  label,
  period,
  unit = { one: "contribution", other: "contributions" },
  inWord = "in",
  thresholds,
  weekStartsOn = 0,
  selectedDate,
  onSelectDate,
  actions,
  locale = "en-US",
  lessLabel = "Less",
  moreLabel = "More",
  caption,
  className,
}: {
  days: HeatDay[];
  label: string;
  period: string;
  unit?: { one: string; other: string };
  inWord?: string;
  thresholds?: number[];
  weekStartsOn?: 0 | 1;
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
  actions?: React.ReactNode;
  locale?: string;
  lessLabel?: string;
  moreLabel?: string;
  /** caption builder: (days, from, to) => "N days with 1–3 visits" */
  caption?: (n: number, from: number, to: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const model = React.useMemo(() => buildModel(days, { thresholds, weekStartsOn, locale }), [days, thresholds, weekStartsOn, locale]);
  const inRange = model.cells.filter((c) => c.inRange);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [seen, setSeen] = React.useState(false);
  const [focus, setFocus] = React.useState(() => inRange[inRange.length - 1]?.date ?? "");
  const [tip, setTip] = React.useState<{ date: string; jump: boolean } | null>(null);
  const [preview, setPreview] = React.useState<number | null>(null);
  const [pinned, setPinned] = React.useState<number | null>(null);
  const [sweep, setSweep] = React.useState<"forward" | "backward">("forward");
  const firstDate = React.useRef(days[0]?.date);

  // wave in the first time the grid is visible
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setSeen(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // a later range change recolours in a sweep forward or backward
  React.useEffect(() => {
    const f = days[0]?.date;
    if (f && firstDate.current && f !== firstDate.current) setSweep(f > firstDate.current ? "forward" : "backward");
    firstDate.current = f;
    setFocus((cur) => (model.cells.some((c) => c.date === cur && c.inRange) ? cur : (inRange[inRange.length - 1]?.date ?? "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  // start scrolled to the most recent weeks
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [model.cols]);

  const byDate = React.useMemo(() => new Map(model.cells.map((c) => [c.date, c])), [model]);
  const fcell = byDate.get(focus);
  const sel = selectedDate ? byDate.get(selectedDate) : undefined;
  const level = pinned ?? preview;
  const df = React.useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }), [locale]);
  const wf = React.useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }), [locale]);
  const unitFor = (n: number) => (n === 1 ? unit.one : unit.other);

  const pitch = 15; // --cell 12 + --gap 3
  const move = (date: string) => {
    const c = byDate.get(date);
    if (!c || !c.inRange) return;
    setFocus(date);
    setTip((t) => ({ date, jump: !t }));
    requestAnimationFrame(() => (gridRef.current?.querySelector(`[data-date="${date}"]`) as HTMLElement | null)?.focus());
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!fcell) return;
    const idx = model.cells.indexOf(fcell);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = idx + 7;
    else if (e.key === "ArrowLeft") next = idx - 7;
    else if (e.key === "ArrowDown") next = idx + 1;
    else if (e.key === "ArrowUp") next = idx - 1;
    else if (e.key === "Home") next = model.cells.findIndex((c) => c.inRange);
    else if (e.key === "End") next = model.cells.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectDate?.(fcell.date);
      return;
    } else if (e.key === "Escape") {
      setTip(null);
      return;
    } else return;
    e.preventDefault();
    const c = model.cells[Math.max(0, Math.min(model.cells.length - 1, next))];
    if (c) move(c.date);
  };

  const tipCell = tip ? byDate.get(tip.date) : undefined;
  const weekdayLabels = Array.from({ length: 7 }, (_, r) => {
    const sample = model.cells.find((c) => c.row === r);
    return sample && r % 2 === 1 ? wf.format(parseUTC(sample.date)) : "";
  });
  const rows = Array.from({ length: 7 }, (_, r) => model.cells.filter((c) => c.row === r));
  const lvlCaption = level != null && caption ? caption(model.perLevel[level], model.ranges[level][0], model.ranges[level][1]) : null;

  return (
    <div ref={rootRef} className={cn(s.root, className)} data-seen={reduced ? "true" : String(seen)}>
      <div className={s.header}>
        <div className={s.title}>
          <RollingNumber value={model.total} /> <span>{unitFor(model.total)}</span> <span>{inWord}</span> <RiseText text={period} />
        </div>
        {actions}
      </div>
      <div ref={scrollRef} className={s.scroller}>
        <div className={s.canvas}>
          <span />
          <div className={s.months} aria-hidden style={{ width: model.cols * pitch }}>
            {model.months.map((m) => (
              <span key={m.col + m.label} style={{ left: m.col * pitch }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className={s.weekdays} aria-hidden>
            {weekdayLabels.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div
            ref={gridRef}
            className={s.grid}
            role="grid"
            aria-label={label}
            data-preview={level ?? undefined}
            onKeyDown={onKey}
            onPointerLeave={() => setTip(null)}
          >
            {rows.map((row, r) => (
              <div key={r} role="row" className={s.row}>
                {row.map((c) => {
                  const wave = Math.round(((c.col + c.row) / (model.cols + 7)) * 420);
                  const sw = sweep === "forward" ? (c.col / model.cols) * 300 : ((model.cols - c.col) / model.cols) * 300;
                  return (
                    <button
                      key={c.date}
                      type="button"
                      role="gridcell"
                      data-date={c.date}
                      data-level={c.level}
                      data-out={!c.inRange}
                      tabIndex={c.date === focus ? 0 : -1}
                      aria-selected={c.date === selectedDate}
                      aria-label={`${c.count} ${unitFor(c.count)}, ${df.format(parseUTC(c.date))}`}
                      disabled={!c.inRange}
                      className={s.cell}
                      style={{ ["--wave" as string]: `${wave}ms`, ["--sweep" as string]: `${Math.round(sw)}ms` }}
                      onPointerEnter={() => c.inRange && setTip((t) => ({ date: c.date, jump: !t }))}
                      onFocus={() => {
                        setFocus(c.date);
                        setTip((t) => ({ date: c.date, jump: !t }));
                      }}
                      onClick={() => {
                        setFocus(c.date);
                        onSelectDate?.(c.date);
                      }}
                    />
                  );
                })}
              </div>
            ))}
            {sel ? <span className={s.ring} aria-hidden style={{ transform: `translate(${sel.col * pitch}px, ${sel.row * pitch}px)` }} /> : null}
            {tipCell ? (
              <motion.div
                className={s.tip}
                aria-hidden
                initial={false}
                animate={{ x: tipCell.col * pitch + 6, y: tipCell.row * pitch - 34 }}
                transition={tip?.jump || reduced ? { duration: 0 } : spring.snappy}
                style={{ translateX: "-50%" }}
              >
                <RollingNumber value={tipCell.count} className={s.tipCount} /> {unitFor(tipCell.count)} · {df.format(parseUTC(tipCell.date))}
              </motion.div>
            ) : null}
          </div>
        </div>
      </div>
      <div className={s.footer}>
        <motion.span key={lvlCaption ?? "none"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.fast }}>
          {lvlCaption ?? " "}
        </motion.span>
        <span className={s.legend}>
          <span>{lessLabel}</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <button
              key={l}
              type="button"
              className={s.swatch}
              style={{ background: `var(--hm-l${l})` }}
              aria-pressed={pinned === l}
              aria-label={caption ? caption(model.perLevel[l], model.ranges[l][0], model.ranges[l][1]) : `Level ${l}`}
              onPointerEnter={() => setPreview(l)}
              onPointerLeave={() => setPreview(null)}
              onFocus={() => setPreview(l)}
              onBlur={() => setPreview(null)}
              onClick={() => setPinned((p) => (p === l ? null : l))}
            />
          ))}
          <span>{moreLabel}</span>
        </span>
      </div>
    </div>
  );
}

export default ActivityHeatmap;

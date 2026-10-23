import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, Search, Send, Trash2 } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { DiningTable, MenuItem, Modifier } from "@/data/types";
import { useDict, useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { cn } from "@/lib/cn";
import { uuid } from "@/lib/id";
import { Button, Dialog, Input, Money, Switch, Textarea, useToast } from "@/ui";
import { wdict } from "./dict";
import { lineTotal, sendRound, type CartLine } from "./orderOps";

export function MenuSheet({ open, onClose, table, guests }: { open: boolean; onClose: () => void; table: DiningTable; guests: number }) {
  const w = useDict(wdict);
  const { loc, dir } = useT();
  const db = useDb();
  const { toast } = useToast();
  const items = useLive("menuItems", { where: { active: true }, orderBy: [{ field: "sort" }] }, { enabled: open }).data;
  const cats = useLive("menuCategories", { where: { active: true }, orderBy: [{ field: "sort" }] }, { enabled: open }).data;
  const groups = useLive("modifierGroups", undefined, { enabled: open }).data;
  const mods = useLive("modifiers", { orderBy: [{ field: "sort" }] }, { enabled: open }).data;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [config, setConfig] = useState<MenuItem | null>(null);
  const [holdLater, setHoldLater] = useState(true);
  const [sending, setSending] = useState(false);
  const [showCart, setShowCart] = useState(false);

  const shown = useMemo(() => items.filter((m) => (!cat || m.categoryId === cat) && (!q.trim() || matches(`${m.name.ar} ${m.name.en}`, q))), [items, cat, q]);
  const count = cart.reduce((a, l) => a + l.qty, 0);
  const total = cart.reduce((a, l) => a + lineTotal(l), 0);
  const Back = dir === "rtl" ? ChevronRight : ChevronLeft;

  const add = (m: MenuItem) => {
    if (!m.available) return;
    if (m.modifierGroupIds.length) return setConfig(m);
    setCart((c) => {
      const same = c.find((l) => l.item.id === m.id && !l.modifiers.length && !l.notes && l.course === 1 && l.seat === null);
      return same ? c.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l)) : [...c, { key: uuid(), item: m, qty: 1, modifiers: [], notes: "", seat: null, course: 1 }];
    });
  };
  const send = async () => {
    if (!cart.length) return;
    setSending(true);
    try {
      await sendRound(db, { table, lines: cart, guests: Math.max(1, guests), categories: cats, holdLater });
      toast({ title: w("w.sent", { t: w("w.table", { n: table.label }) }), tone: "success" });
      setCart([]);
      setShowCart(false);
      onClose();
    } catch {
      toast({ title: loc({ ar: "حصلت مشكلة، جرّب تاني", en: "Something went wrong, try again" }), tone: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      variant="auto"
      title={config ? loc(config.name) : `${w("w.addItems")} · ${w("w.table", { n: table.label })}`}
      className="sm:h-[min(88dvh,820px)]"
      footer={
        config ? null : (
          <div className="flex w-full items-center gap-2">
            <button type="button" onClick={() => setShowCart((v) => !v)} className="min-w-0 flex-1 text-start" aria-expanded={showCart}>
              <span className="block text-[12.5px] text-muted">{w("w.cart")}</span>
              <span className="block truncate text-[15px] font-bold">
                {count ? (
                  <>
                    {count} · <Money value={total} />
                  </>
                ) : (
                  w("w.empty")
                )}
              </span>
            </button>
            <Button size="lg" icon={<Send className="size-5" />} disabled={!count} loading={sending} onClick={send}>
              {w("w.send", { n: count })}
            </Button>
          </div>
        )
      }
    >
      {config ? (
        <ItemConfig
          item={config}
          groups={groups.filter((g) => config.modifierGroupIds.includes(g.id)).sort((a, b) => config.modifierGroupIds.indexOf(a.id) - config.modifierGroupIds.indexOf(b.id))}
          mods={mods}
          guests={guests}
          onBack={() => setConfig(null)}
          backIcon={<Back className="size-4.5" />}
          onAdd={(l) => {
            setCart((c) => [...c, l]);
            setConfig(null);
          }}
        />
      ) : showCart ? (
        <CartView cart={cart} setCart={setCart} holdLater={holdLater} setHoldLater={setHoldLater} onBack={() => setShowCart(false)} backIcon={<Back className="size-4.5" />} />
      ) : (
        <div className="grid gap-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={w("w.search")} icon={<Search />} aria-label={w("w.search")} wrapClassName="sticky top-0 z-10 bg-surface pt-1" />
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar">
            <Chip on={!cat} onClick={() => setCat(null)}>
              {w("w.allCats")}
            </Chip>
            {cats.map((c) => (
              <Chip key={c.id} on={cat === c.id} onClick={() => setCat(c.id)}>
                {loc(c.name)}
              </Chip>
            ))}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((m) => {
              const inCart = cart.filter((l) => l.item.id === m.id).reduce((a, l) => a + l.qty, 0);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={!m.available}
                    onClick={() => add(m)}
                    className={cn(
                      "flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-surface px-3 py-2 text-start transition-colors hover:border-line-strong active:bg-surface-2",
                      inCart ? "border-primary/60 bg-primary-soft/40" : "border-line",
                      !m.available && "opacity-55",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[15px] font-semibold", !m.available && "line-through")}>{loc(m.name)}</span>
                      <span className="block text-[13px] text-muted">{m.available ? <Money value={m.price} /> : <span className="font-bold text-danger">{w("w.soldOut")}</span>}</span>
                    </span>
                    {inCart ? <span className="grid size-8 place-items-center rounded-full bg-primary font-mono text-[14px] font-bold text-primary-ink">{inCart}</span> : m.available ? <Plus className="size-5 text-muted" aria-label={w("w.add")} /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("h-10 shrink-0 rounded-full border px-3.5 text-[14px] font-semibold", on ? "border-transparent bg-ink text-bg" : "border-line bg-surface text-ink-2")}>
      {children}
    </button>
  );
}

function Stepper({ value, onChange, min = 1, label }: { value: number; onChange: (n: number) => void; min?: number; label: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1" role="group" aria-label={label}>
      <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-surface-2 disabled:opacity-40" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="−">
        <Minus className="size-4.5" />
      </button>
      <span className="min-w-8 text-center font-mono text-[17px] font-bold">{value}</span>
      <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-surface-2" onClick={() => onChange(value + 1)} aria-label="+">
        <Plus className="size-4.5" />
      </button>
    </div>
  );
}

function Picker({ label, value, options, onChange }: { label: string; value: number | null; options: (number | null)[]; onChange: (v: number | null) => void }) {
  const w = useDict(wdict);
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={String(o)} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={cn("h-10 min-w-10 rounded-xl border px-3 font-mono text-[15px] font-bold", value === o ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface")}>
            {o === null ? w("w.none") : o}
          </button>
        ))}
      </div>
    </div>
  );
}

function ItemConfig({ item, groups, mods, guests, onBack, onAdd, backIcon }: { item: MenuItem; groups: { id: string; name: { ar: string; en: string }; min: number; max: number }[]; mods: Modifier[]; guests: number; onBack: () => void; onAdd: (l: CartLine) => void; backIcon: React.ReactNode }) {
  const w = useDict(wdict);
  const { loc } = useT();
  const [picked, setPicked] = useState<Record<string, string[]>>(() => Object.fromEntries(groups.map((g) => [g.id, mods.filter((m) => m.groupId === g.id && m.isDefault && m.available).map((m) => m.id).slice(0, g.max)])));
  const [qty, setQty] = useState(1);
  const [seat, setSeat] = useState<number | null>(null);
  const [course, setCourse] = useState<number | null>(1);
  const [notes, setNotes] = useState("");
  const ok = groups.every((g) => (picked[g.id]?.length ?? 0) >= g.min);
  const chosen = mods.filter((m) => Object.values(picked).flat().includes(m.id));
  const toggle = (g: { id: string; max: number }, id: string) =>
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      if (g.max === 1) return { ...p, [g.id]: [id] };
      if (cur.includes(id)) return { ...p, [g.id]: cur.filter((x) => x !== id) };
      return cur.length >= g.max ? p : { ...p, [g.id]: [...cur, id] };
    });
  return (
    <div className="grid gap-4">
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-[14px] font-semibold text-primary">
        {backIcon} {w("w.menu")}
      </button>
      {groups.map((g) => (
        <fieldset key={g.id}>
          <legend className="mb-1.5 flex items-center gap-2 text-[14.5px] font-bold">
            {loc(g.name)}
            <span className={cn("text-[12px] font-semibold", g.min ? "text-danger" : "text-muted")}>{g.min ? w("w.required") : w("w.pickUpTo", { n: g.max })}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {mods
              .filter((m) => m.groupId === g.id)
              .map((m) => {
                const on = picked[g.id]?.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    role={g.max === 1 ? "radio" : "checkbox"}
                    aria-checked={on}
                    disabled={!m.available}
                    onClick={() => toggle(g, m.id)}
                    className={cn("min-h-11 rounded-xl border px-3.5 text-[14.5px] font-semibold", on ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface", !m.available && "opacity-40 line-through")}
                  >
                    {loc(m.name)}
                    {m.price ? (
                      <span className="ms-1.5 text-[12.5px] text-muted">
                        +<Money value={m.price} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-end gap-5">
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-muted">{w("w.qty")}</p>
          <Stepper value={qty} onChange={setQty} label={w("w.qty")} />
        </div>
        <Picker label={w("w.courseN")} value={course} options={[1, 2, 3]} onChange={(v) => setCourse(v ?? 1)} />
        <Picker label={w("w.seatN")} value={seat} options={[null, ...Array.from({ length: Math.min(8, Math.max(guests, 2)) }, (_, i) => i + 1)]} onChange={setSeat} />
      </div>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={w("w.notes")} rows={2} maxLength={200} aria-label={w("w.notes")} />
      <Button size="lg" disabled={!ok} onClick={() => onAdd({ key: uuid(), item, qty, modifiers: chosen, notes, seat, course: course ?? 1 })}>
        {w("w.add")} · <Money value={qty * (item.price + chosen.reduce((a, m) => a + m.price, 0))} />
      </Button>
    </div>
  );
}

function CartView({ cart, setCart, holdLater, setHoldLater, onBack, backIcon }: { cart: CartLine[]; setCart: (f: (c: CartLine[]) => CartLine[]) => void; holdLater: boolean; setHoldLater: (v: boolean) => void; onBack: () => void; backIcon: React.ReactNode }) {
  const w = useDict(wdict);
  const { loc } = useT();
  const courses = new Set(cart.map((l) => l.course));
  return (
    <div className="grid gap-3">
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-[14px] font-semibold text-primary">
        {backIcon} {w("w.menu")}
      </button>
      {!cart.length ? <p className="py-8 text-center text-muted">{w("w.empty")}</p> : null}
      <ul className="grid gap-2">
        {cart.map((l) => (
          <li key={l.key} className="flex items-start gap-3 rounded-2xl border border-line p-2.5">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{loc(l.item.name)}</p>
              {l.modifiers.length ? <p className="text-[13px] text-brass-text">{l.modifiers.map((m) => loc(m.name)).join(" · ")}</p> : null}
              {l.notes ? <p className="text-[13px] text-warn">{l.notes}</p> : null}
              <p className="mt-0.5 text-[12px] text-muted">
                {w("w.courseN")} {l.course}
                {l.seat ? ` · ${w("w.seatN")} ${l.seat}` : ""} · <Money value={lineTotal(l)} />
              </p>
            </div>
            <Stepper value={l.qty} onChange={(n) => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: n } : x)))} label={w("w.qty")} />
            <button type="button" aria-label={w("w.remove")} className="grid size-11 place-items-center rounded-xl text-danger hover:bg-danger-soft" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>
              <Trash2 className="size-4.5" />
            </button>
          </li>
        ))}
      </ul>
      {courses.size > 1 ? <Switch checked={holdLater} onChange={setHoldLater} label={w("w.holdLater")} /> : null}
    </div>
  );
}

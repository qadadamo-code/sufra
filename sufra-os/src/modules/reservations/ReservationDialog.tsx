import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeDollarSign, Minus, Plus, Sparkles, Users } from "lucide-react";
import { useBranch } from "@/auth/session";
import { useDb } from "@/data/hooks";
import type { Check, DiningTable, Reservation, ReservationStatus, ReservationTag } from "@/data/types";
import { useDict, useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { major } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { Badge, Button, Dialog, Input, Select, Switch, Textarea, useToast } from "@/ui";
import { bookingSlots, parseHours } from "@/modules/floor/core/availability";
import { conflictsOf, defaultDuration, suggestTables } from "@/modules/floor/core/reservations";
import type { Layout } from "@/modules/floor/core/types";
import { coreChecks, coreReservation, toMin } from "@/modules/floor/model";
import { normalizePhone, validPhone } from "./booking";
import { resDict } from "./dict";
import { TAG_ICON } from "./Timeline";
import { parseDate } from "./useRes";

const TAGS: ReservationTag[] = ["vip", "birthday", "kids", "quiet", "smoking"];
const STATUSES: ReservationStatus[] = ["pending", "confirmed", "seated", "done", "no_show", "cancelled"];

export interface DraftInit {
  date: string;
  startsAt?: string;
  tableId?: string | null;
}

export function ReservationDialog({ open, onClose, editing, init, layout, tables, capacity, reservations, checks }: {
  open: boolean;
  onClose: () => void;
  editing: Reservation | null;
  init: DraftInit;
  layout: Layout;
  tables: DiningTable[];
  capacity: (id: string) => number;
  reservations: Reservation[];
  checks: Check[];
}) {
  const r = useDict(resDict);
  const { t, L, lang } = useT();
  const db = useDb();
  const branch = useBranch();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState<string>("");
  const [duration, setDuration] = useState(75);
  const [tableIds, setTableIds] = useState<string[]>([]);
  const [tags, setTags] = useState<ReservationTag[]>([]);
  const [note, setNote] = useState("");
  const [deposit, setDeposit] = useState("");
  const [depositPaid, setDepositPaid] = useState(false);
  const [status, setStatus] = useState<ReservationStatus>("confirmed");
  const [source, setSource] = useState<Reservation["source"]>("phone");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [touchedDuration, setTouchedDuration] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTried(false);
    if (editing) {
      const d = new Date(editing.startsAt);
      const hrs = parseHours(branch?.openingHours);
      // a booking at 00:30 belongs to the previous service night
      if (hrs.close > 1440 && d.getHours() * 60 + d.getMinutes() < hrs.open && d.getHours() * 60 + d.getMinutes() <= hrs.close - 1440) d.setDate(d.getDate() - 1);
      const t0 = new Date(editing.startsAt);
      setName(editing.name);
      setPhone(editing.phone);
      setParty(editing.party);
      setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      setTime(`${String(t0.getHours()).padStart(2, "0")}:${String(t0.getMinutes()).padStart(2, "0")}`);
      setDuration(editing.durationMin);
      setTableIds(editing.tableIds);
      setTags(editing.tags);
      setNote(editing.note);
      setDeposit(editing.deposit ? String(editing.deposit / 100_000) : "");
      setDepositPaid(!!editing.depositPaid);
      setStatus(editing.status === "waiting" ? "confirmed" : editing.status);
      setSource(editing.source);
      setTouchedDuration(true);
    } else {
      const d = init.startsAt ? new Date(init.startsAt) : null;
      setName("");
      setPhone("");
      setParty(2);
      setDate(init.date);
      setTime(d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "20:00");
      setDuration(75);
      setTableIds(init.tableId ? [init.tableId] : []);
      setTags([]);
      setNote("");
      setDeposit("");
      setDepositPaid(false);
      setStatus("confirmed");
      setSource("phone");
      setTouchedDuration(false);
    }
  }, [open, editing, init, branch]);

  useEffect(() => {
    if (!touchedDuration) setDuration(defaultDuration(party));
  }, [party, touchedDuration]);

  const startsAt = useMemo(() => {
    const [h, m] = (time || "20:00").split(":").map(Number);
    const d = parseDate(date);
    // hours after midnight belong to the same service night
    const hours = parseHours(branch?.openingHours);
    const mins = h * 60 + m;
    d.setHours(0, mins < hours.open && hours.close > 1440 && mins < hours.close - 1440 + 1 ? mins + 1440 : mins, 0, 0);
    return d.toISOString();
  }, [date, time, branch]);

  const others = useMemo(() => reservations.filter((x) => x.id !== editing?.id), [reservations, editing]);
  const coreOthers = useMemo(() => others.map(coreReservation), [others]);
  const coreCk = useMemo(() => coreChecks(checks, [], []), [checks]);
  const nowMin = Date.now() / 60000;

  const timeOptions = useMemo(() => {
    const hours = parseHours(branch?.openingHours);
    const dayStart = Math.floor(parseDate(date).getTime() / 60000);
    const slots = bookingSlots({ dayStart, party, hours, now: nowMin, leadMinutes: -24 * 60, lastSeatingBeforeClose: 30 }, layout, coreOthers, coreCk);
    return slots.map((s) => {
      const d = new Date(s.start * 60000);
      const v = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const label = d.toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit", hour12: lang === "ar" });
      return { value: v, label: s.ok ? label : `${label} — ${L("مفيش مكان", "full")}` };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, party, layout, coreOthers, coreCk, branch, lang]);

  const suggestions = useMemo(() => suggestTables(party, toMin(startsAt), duration, layout, coreOthers, coreCk, nowMin, { excludeId: editing?.id }), [party, startsAt, duration, layout, coreOthers, coreCk, editing, nowMin]);
  const label = (id: string) => tables.find((x) => x.id === id)?.label ?? "?";

  const draft: Reservation | null = useMemo(
    () => (editing ? { ...editing, startsAt, durationMin: duration, tableIds, status, party } : ({ id: "draft", startsAt, durationMin: duration, tableIds, status, party, name, phone, note, tags } as Reservation)),
    [editing, startsAt, duration, tableIds, status, party, name, phone, note, tags],
  );
  const clashes = draft ? conflictsOf(coreReservation(draft), [...coreOthers, coreReservation(draft)]) : [];
  const seats = tableIds.reduce((s, id) => s + capacity(id), 0);

  const nameErr = tried && !name.trim() ? r("form.required") : undefined;
  const phoneErr = tried && (!phone.trim() || !validPhone(phone)) ? r("form.required") : undefined;

  const save = async () => {
    setTried(true);
    if (!name.trim() || !validPhone(phone) || !branch) return;
    setBusy(true);
    try {
      const base = {
        name: name.trim(), phone: normalizePhone(phone), party, startsAt, durationMin: duration, tableIds, tags, note: note.trim(), status, source,
        deposit: deposit ? major(deposit) : 0, depositPaid: deposit ? depositPaid : false,
      };
      if (editing) {
        await db.update("reservations", editing.id, base);
        await db.audit("reservation.edit", "reservations", editing.id);
      } else {
        const [customer] = await db.list("customers", { where: { phone: base.phone } });
        const row = await db.insert("reservations", { ...base, branchId: branch.id, customerId: customer?.id ?? null, arrivedAt: null, seatedAt: null, createdAt: nowIso() } as never);
        await db.audit("reservation.create", "reservations", (row as Reservation).id);
      }
      toast({ title: r("res.saved"), tone: "success" });
      onClose();
    } catch {
      toast({ title: L("حصلت مشكلة", "Something went wrong"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? editing.name : r("res.new")}
      description={editing ? `${r(`status.${editing.status}`)} · ${r(`src.${editing.source}`)}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} loading={busy}>
            {editing ? r("form.save") : r("form.create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pt-1 sm:grid-cols-2">
        <Input label={r("form.name")} value={name} onChange={(e) => setName(e.target.value)} error={nameErr} data-autofocus autoComplete="off" />
        <Input label={r("form.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} error={phoneErr} inputMode="tel" dir="ltr" className="num" placeholder="01xxxxxxxxx" />

        <div className="space-y-1.5 sm:col-span-2">
          <p className="text-[13.5px] font-semibold text-ink-2">{r("form.party")}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" aria-label="−" onClick={() => setParty((p) => Math.max(1, p - 1))} className="grid size-11 place-items-center rounded-xl border border-line hover:bg-surface-3">
              <Minus className="size-4" />
            </button>
            <span className="num w-10 text-center text-[22px] font-bold">{party}</span>
            <button type="button" aria-label="+" onClick={() => setParty((p) => Math.min(60, p + 1))} className="grid size-11 place-items-center rounded-xl border border-line hover:bg-surface-3">
              <Plus className="size-4" />
            </button>
            <span className="mx-1 h-6 w-px bg-line" />
            {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
              <button key={n} type="button" onClick={() => setParty(n)} className={cn("num h-11 min-w-11 rounded-xl border px-2 text-[15px] font-bold transition-colors", party === n ? "border-primary bg-primary text-primary-ink" : "border-line hover:border-line-strong")}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <Input label={r("form.date")} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} dir="ltr" />
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Select label={r("form.time")} value={time} onChange={(e) => setTime(e.target.value)} options={timeOptions.some((o) => o.value === time) ? timeOptions : [{ value: time, label: time }, ...timeOptions]} />
          <Select
            label={r("form.duration")}
            value={String(duration)}
            onChange={(e) => {
              setTouchedDuration(true);
              setDuration(Number(e.target.value));
            }}
            options={[45, 60, 75, 90, 105, 120, 150, 180, 240].map((m) => ({ value: String(m), label: r("form.min", { n: m }) }))}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-center justify-between">
            <p className="text-[13.5px] font-semibold text-ink-2">{r("form.tables")}</p>
            {tableIds.length ? (
              <Badge tone={seats >= party ? "ok" : "warn"} icon={<Users />}>
                {r("form.capacity", { n: seats })}
              </Badge>
            ) : null}
          </div>
          {suggestions.length ? (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => {
                const on = s.tableIds.length === tableIds.length && s.tableIds.every((x) => tableIds.includes(x));
                return (
                  <button key={s.tableIds.join()} type="button" onClick={() => setTableIds(s.tableIds)} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-start transition-colors", on ? "border-primary bg-primary-soft" : "border-line bg-surface-2 hover:border-line-strong")}>
                    <Sparkles className="size-4 shrink-0 text-brass" />
                    <span>
                      <span className="block text-[14px] font-bold">
                        {s.tableIds.map(label).join(" + ")} <span className="num text-[12px] font-semibold text-muted">· {s.capacity}</span>
                      </span>
                      <span className="block text-[11.5px] text-muted">{s.reasons.map((x) => r(`form.reasons.${x}`)).join(" · ") || r("form.suggested")}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">{r("form.noSuggest")}</p>
          )}
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto thin-scrollbar">
            {tables.map((tb) => {
              const on = tableIds.includes(tb.id);
              return (
                <button key={tb.id} type="button" aria-pressed={on} onClick={() => setTableIds((xs) => (on ? xs.filter((x) => x !== tb.id) : [...xs, tb.id]))} className={cn("num h-9 min-w-10 rounded-lg border px-2 text-[13.5px] font-bold transition-colors", on ? "border-primary bg-primary text-primary-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                  {tb.label}
                </button>
              );
            })}
          </div>
          {clashes.length ? (
            <p className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger">
              <AlertTriangle className="size-4 shrink-0" />
              {r("res.clash")}: {clashes.map((c) => c.name).join("، ")}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <p className="text-[13.5px] font-semibold text-ink-2">{r("form.tags")}</p>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((tg) => {
              const I = TAG_ICON[tg];
              const on = tags.includes(tg);
              return (
                <button key={tg} type="button" aria-pressed={on} onClick={() => setTags((xs) => (on ? xs.filter((x) => x !== tg) : [...xs, tg]))} className={cn("inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors", on ? "border-brass bg-brass-soft text-brass-text" : "border-line text-ink-2 hover:border-line-strong")}>
                  <I className="size-4" />
                  {r(`tag.${tg}`)}
                </button>
              );
            })}
          </div>
        </div>

        <Textarea label={r("form.note")} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="sm:col-span-2" />

        <div className="space-y-2 rounded-2xl border border-line p-3 sm:col-span-2">
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <Input label={r("form.deposit")} icon={<BadgeDollarSign />} value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" className="num" hint={r("form.depositHint")} />
            {deposit ? <Switch checked={depositPaid} onChange={setDepositPaid} label={r("form.depositPaid")} /> : null}
          </div>
        </div>

        {editing ? (
          <>
            <Select label={r("form.status")} value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus)} options={STATUSES.map((s) => ({ value: s, label: r(`status.${s}`) }))} />
            <Select label={r("form.source")} value={source} onChange={(e) => setSource(e.target.value as Reservation["source"])} options={(["phone", "walk_in", "online", "app"] as const).map((s) => ({ value: s, label: r(`src.${s}`) }))} />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

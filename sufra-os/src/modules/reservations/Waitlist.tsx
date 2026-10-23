import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Armchair, Hourglass, MessageCircle, Minus, Phone, Plus, Trash2, UserPlus } from "lucide-react";
import { useBranch } from "@/auth/session";
import { useDb } from "@/data/hooks";
import type { Check, Reservation } from "@/data/types";
import { useDict, useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { nowIso } from "@/lib/time";
import { Badge, Button, Card, EmptyState, IconButton, Input, useReduced, useToast } from "@/ui";
import { defaultDuration, suggestTables, waitEstimate } from "@/modules/floor/core/reservations";
import type { Layout } from "@/modules/floor/core/types";
import { coreChecks, coreReservation } from "@/modules/floor/model";
import { normalizePhone, validPhone } from "./booking";
import { resDict } from "./dict";
import { seatReservation } from "./useRes";

export function Waitlist({ waiting, layout, reservations, checks, now, labels, restaurantName }: { waiting: Reservation[]; layout: Layout; reservations: Reservation[]; checks: Check[]; now: number; labels: Map<string, string>; restaurantName: string }) {
  const r = useDict(resDict);
  const { L, t } = useT();
  const db = useDb();
  const branch = useBranch();
  const { toast } = useToast();
  const reduced = useReduced();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState(2);
  const [quote, setQuote] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const nowMin = now / 60000;
  const coreRes = useMemo(() => reservations.map(coreReservation), [reservations]);
  const coreCk = useMemo(() => coreChecks(checks, [], []), [checks]);
  const estimate = useMemo(() => waitEstimate(party, layout, coreRes, coreCk, nowMin), [party, layout, coreRes, coreCk, nowMin]);

  const add = async () => {
    if (!name.trim() || !branch) return;
    setBusy("add");
    try {
      const q = quote ? Number(quote) : estimate ?? 30;
      await db.insert("reservations", {
        branchId: branch.id, customerId: null, name: name.trim(), phone: phone ? normalizePhone(phone) : "", party, startsAt: nowIso(), durationMin: defaultDuration(party), tableIds: [],
        status: "waiting", note: "", tags: [], source: "walk_in", quotedWaitMin: q, deposit: 0, depositPaid: false, arrivedAt: nowIso(), seatedAt: null,
      } as never);
      setName("");
      setPhone("");
      setQuote("");
      setParty(2);
    } finally {
      setBusy(null);
    }
  };

  const seat = async (w: Reservation) => {
    setBusy(w.id);
    try {
      const tables = await seatReservation(db, w, layout, reservations, checks);
      toast({ title: L(`اتقعدوا على ${tables.map((x) => labels.get(x)).join(" + ")}`, `Seated at ${tables.map((x) => labels.get(x)).join(" + ")}`), tone: "success" });
    } catch (e) {
      toast({ title: (e as Error).message === "no_table" ? r("form.noSuggest") : L("حصلت مشكلة", "Something went wrong"), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const wa = (w: Reservation) => {
    const p = normalizePhone(w.phone).replace(/^0/, "20");
    return `https://wa.me/${p}?text=${encodeURIComponent(r("wait.msg", { name: w.name, place: restaurantName }))}`;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="h-fit space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-[16px] font-bold">
          <UserPlus className="size-5 text-primary" /> {r("wait.add")}
        </h3>
        <Input label={r("form.name")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <Input label={r("form.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" className="num" error={phone && !validPhone(phone) ? r("book.phoneInvalid") : undefined} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13.5px] font-semibold text-ink-2">{r("form.party")}</span>
          <div className="flex items-center gap-1">
            <IconButton size="sm" variant="secondary" label="−" onClick={() => setParty((p) => Math.max(1, p - 1))}>
              <Minus />
            </IconButton>
            <span className="num w-9 text-center text-[20px] font-bold">{party}</span>
            <IconButton size="sm" variant="secondary" label="+" onClick={() => setParty((p) => Math.min(30, p + 1))}>
              <Plus />
            </IconButton>
          </div>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[12.5px] font-semibold text-muted">{r("wait.quote")}</p>
          <div className="mt-1 flex items-center gap-2">
            <Hourglass className="size-5 text-brass" />
            <span className="font-display text-[22px] font-semibold">{estimate === null ? r("wait.tonight") : estimate === 0 ? r("wait.now") : r("wait.estimate", { n: estimate })}</span>
          </div>
          <Input label={L("أو اكتب الوقت بنفسك (دقايق)", "Or quote your own (minutes)")} value={quote} onChange={(e) => setQuote(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="num" wrapClassName="mt-2" />
        </div>
        <Button block size="lg" icon={<UserPlus />} onClick={add} loading={busy === "add"} disabled={!name.trim()}>
          {r("wait.add")}
        </Button>
      </Card>

      <div className="space-y-2.5">
        {waiting.length ? (
          <AnimatePresence initial={false}>
            {waiting.map((w, i) => {
              const waited = Math.max(0, Math.floor((now - Date.parse(w.arrivedAt ?? w.createdAt)) / 60000));
              const q = w.quotedWaitMin ?? 30;
              const pct = Math.min(100, (waited / Math.max(1, q)) * 100);
              const over = waited > q;
              const best = suggestTables(w.party, nowMin, w.durationMin, layout, coreRes, coreCk, nowMin, { excludeId: w.id })[0];
              return (
                <motion.div key={w.id} layout={!reduced} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
                  <Card className="relative overflow-hidden p-3.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="num grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-3 text-[18px] font-bold">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16px] font-bold">{w.name}</p>
                        <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                          <span>{t("common.guests", { n: w.party })}</span>
                          <span className={cn("num font-semibold", over ? "text-danger" : "text-ink-2")}>
                            {r("wait.waited")} {waited}′ / {q}′
                          </span>
                          {over ? <Badge tone="danger" size="sm">{r("wait.over")}</Badge> : null}
                        </p>
                      </div>
                      {best ? (
                        <Badge tone="ok" icon={<Armchair />}>
                          {r("wait.suggest")}: {best.tableIds.map((x) => labels.get(x)).join(" + ")}
                        </Badge>
                      ) : null}
                      <div className="flex items-center gap-1.5">
                        {w.phone ? (
                          <>
                            <a href={wa(w)} target="_blank" rel="noreferrer" aria-label={r("wait.notify")} title={r("wait.notify")} className="grid size-11 place-items-center rounded-xl bg-ok-soft text-ok hover:brightness-95">
                              <MessageCircle className="size-5" />
                            </a>
                            <a href={`tel:${w.phone}`} aria-label={r("act.call")} title={r("act.call")} className="grid size-11 place-items-center rounded-xl bg-surface-3 text-ink-2 hover:bg-line">
                              <Phone className="size-5" />
                            </a>
                          </>
                        ) : null}
                        <Button icon={<Armchair />} onClick={() => seat(w)} loading={busy === w.id} disabled={!best}>
                          {r("act.seat")}
                        </Button>
                        <IconButton label={r("act.cancel")} onClick={() => db.update("reservations", w.id, { status: "cancelled" })}>
                          <Trash2 />
                        </IconButton>
                      </div>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-surface-3">
                      <div className={cn("h-full transition-[width] duration-700", over ? "bg-danger" : pct > 75 ? "bg-warn" : "bg-ok")} style={{ width: `${pct}%` }} />
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        ) : (
          <EmptyState icon={<Hourglass />} title={r("wait.empty")} body={r("wait.emptyBody")} />
        )}
      </div>
    </div>
  );
}

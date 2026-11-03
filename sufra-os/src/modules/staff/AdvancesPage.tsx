import { useState } from "react";
import { Banknote, Check, HandCoins, Landmark, Plus, Wallet, X } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { Advance } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { Button, Dialog, EmptyState, Select, StatTile, Table, useToast } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { decideAdvance, HrError, payAdvance } from "@/modules/hr/ops";
import { outstanding } from "@/modules/hr/lib/advances";
import { AdvanceCard } from "@/modules/hr/components";
import { AdvanceRequestDialog } from "@/modules/hr/forms";
import { PersonCell, PersonPhoto, Section } from "@/modules/hr/ui";

export default function AdvancesPage() {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const all = useLive("advances", { orderBy: [{ field: "requestedAt", dir: "desc" }] }).data;
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Advance | null>(null);
  const money = (u: number) => formatMoney(u, { lang, currency: hr.currency, compact: true });
  const requested = all.filter((a) => a.status === "requested");
  const toPay = all.filter((a) => a.status === "approved");
  const active = all.filter((a) => a.status === "paid");
  const out = active.reduce((x, a) => x + outstanding(a), 0);
  const byPerson = [...new Set(all.filter((a) => a.status === "paid" || a.status === "settled").map((a) => a.membershipId))];
  const who = (a: Advance) => {
    const m = hr.memberOf(a.membershipId);
    return m ? <PersonCell m={m} p={hr.profileOf(m.id)} size="sm" /> : null;
  };
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} tone="brass" icon={<HandCoins />} label={L("سلف لسه عليهم", "Outstanding advances")} value={money(out)} sub={L(`${active.length} سلفة بتتخصم`, `${active.length} recovering`)} />
        <StatTile index={1} tone="warn" icon={<Plus />} label={L("طلبات جديدة", "New requests")} value={requested.length} />
        <StatTile index={2} tone="info" icon={<Wallet />} label={L("مستنية الصرف", "To pay out")} value={toPay.length} sub={money(toPay.reduce((x, a) => x + a.amount, 0))} />
        <StatTile index={3} tone="ok" icon={<Check />} label={L("خلصت السنة دي", "Settled this year")} value={all.filter((a) => a.status === "settled").length} />
      </div>

      <Section title={L("طلبات السلف", "Advance requests")} icon={<HandCoins />} action={hr.canManage ? <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>{L("سلفة جديدة", "New advance")}</Button> : null}>
        {requested.length || toPay.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {[...requested, ...toPay].map((a) => (
              <div key={a.id} className="grid gap-2">
                <div className="flex items-center gap-2">{who(a)}</div>
                <AdvanceCard
                  a={a}
                  right={
                    a.status === "requested" && hr.canManage ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="soft" icon={<Check />} onClick={async () => { await decideAdvance(db, a, true); toast({ title: L("اتوافق — المحاسب يصرفها", "Approved — accounts pays it out"), tone: "success" }); }}>{L("وافق", "Approve")}</Button>
                        <Button size="sm" variant="ghost" icon={<X />} onClick={() => decideAdvance(db, a, false)}>{L("ارفض", "Reject")}</Button>
                      </div>
                    ) : a.status === "approved" && (hr.canPay || hr.canManage) ? (
                      <Button size="sm" icon={<Banknote />} onClick={() => setPaying(a)}>{L("اصرف", "Pay out")}</Button>
                    ) : null
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState compact icon={<HandCoins />} title={L("مفيش طلبات", "No requests")} />
        )}
      </Section>

      <Section title={L("رصيد السلف لكل موظف", "Advance balance per employee")} bodyClass="px-0 pb-2">
        <Table
          rows={byPerson}
          rowKey={(id) => id}
          empty={<EmptyState compact title={L("مفيش سلف", "No advances")} />}
          columns={[
            { key: "who", header: L("الموظف", "Staff"), cell: (id) => { const m = hr.memberOf(id); return m ? <PersonCell m={m} p={hr.profileOf(id)} size="sm" /> : null; } },
            { key: "total", header: L("اتصرف", "Paid out"), cell: (id) => <span className="tabular-nums">{money(all.filter((a) => a.membershipId === id && (a.status === "paid" || a.status === "settled")).reduce((x, a) => x + a.amount, 0))}</span>, align: "end" },
            { key: "rec", header: L("اتخصم", "Recovered"), cell: (id) => <span className="tabular-nums">{money(all.filter((a) => a.membershipId === id).reduce((x, a) => x + a.recovered, 0))}</span>, align: "end", hideOnMobile: true },
            { key: "left", header: L("الباقي", "Outstanding"), cell: (id) => <span className="tabular-nums font-bold">{money(all.filter((a) => a.membershipId === id).reduce((x, a) => x + outstanding(a), 0))}</span>, align: "end" },
          ]}
        />
      </Section>

      {active.length ? (
        <Section title={L("بتتخصم من المرتب", "Recovering through payroll")}>
          <div className="grid gap-3 lg:grid-cols-2">
            {active.map((a) => (
              <div key={a.id} className="grid gap-2">
                {who(a)}
                <AdvanceCard a={a} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}
      {adding ? <AdvanceRequestDialog managerMode onClose={() => setAdding(false)} /> : null}
      {paying ? <PayDialog a={paying} onClose={() => setPaying(null)} /> : null}
    </div>
  );
}

function PayDialog({ a, onClose }: { a: Advance; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const shifts = useLive("shifts", { where: { status: "open" } }).data;
  const [via, setVia] = useState<"cash" | "bank" | "wallet">(shifts.length ? "cash" : "bank");
  const [shiftId, setShiftId] = useState("");
  const shift = shifts.find((s) => s.id === (shiftId || shifts[0]?.id)) ?? null;
  const m = hr.memberOf(a.membershipId);
  return (
    <Dialog
      open
      onClose={onClose}
      title={L("صرف السلفة", "Pay out the advance")}
      description={`${m?.name ?? ""} · ${formatMoney(a.amount, { lang, currency: hr.currency })}`}
      footer={
        <Button
          block
          icon={<Banknote />}
          onClick={async () => {
            try {
              await payAdvance(db, a, via, via === "cash" ? shift : null);
              toast({ title: via === "cash" ? L("اتصرفت من الدرج — متسجلة في الوردية والقيود", "Paid from the drawer — on the shift and in the books") : L("اتصرفت — متسجلة في القيود", "Paid — posted to the books"), tone: "success" });
              onClose();
            } catch (e) {
              toast({ title: e instanceof HrError && e.code === "no_shift" ? L("مفيش وردية كاشير مفتوحة — افتح وردية أو اصرف تحويل", "No open POS shift — open one or pay by transfer") : String((e as Error).message), tone: "error" });
            }
          }}
        >
          {L("اصرف", "Pay")}
        </Button>
      }
    >
      <div className="grid gap-3">
        {m ? <div className="flex items-center gap-3"><PersonPhoto m={m} p={hr.profileOf(m.id)} /> <span className="font-semibold">{m.name}</span></div> : null}
        <div className="grid grid-cols-3 gap-2">
          {([["cash", L("كاش من الدرج", "Cash from drawer"), <Banknote key="c" />], ["bank", L("تحويل بنكي", "Bank"), <Landmark key="b" />], ["wallet", L("محفظة", "Wallet"), <Wallet key="w" />]] as const).map(([k, label, icon]) => (
            <button key={k} type="button" aria-pressed={via === k} onClick={() => setVia(k)} className={`grid h-20 place-items-center rounded-2xl border text-[13px] font-semibold [&_svg]:size-5 ${via === k ? "border-primary bg-primary-soft text-primary" : "border-line"}`}>
              {icon}
              {label}
            </button>
          ))}
        </div>
        {via === "cash" ? (
          shifts.length ? (
            <Select label={L("من أنهي درج؟", "Which drawer?")} value={shiftId || shifts[0].id} onChange={(e) => setShiftId(e.target.value)} options={shifts.map((s) => ({ value: s.id, label: `${s.device} · ${hr.memberOf(s.openedBy)?.name ?? ""}` }))} />
          ) : (
            <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13.5px] text-warn">{L("مفيش وردية كاشير مفتوحة دلوقتي", "No POS shift is open right now")}</p>
          )
        ) : null}
        <p className="text-[12.5px] text-muted">{L("القيد: من حـ/ سلف العاملين (١٢٠٢) إلى حـ/ الخزينة أو البنك", "Journal: Dr staff advances (1202) / Cr cash or bank")}</p>
      </div>
    </Dialog>
  );
}

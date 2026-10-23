/** Shift & drawer: open with a float, paid in/out, no-sale, X report, blind close → Z report with over/short. */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Banknote, FileBarChart2, Lock, PackageOpen, Printer, Wallet } from "lucide-react";
import { useApproval } from "@/auth/approval";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { CashMoveKind } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, major, type Units } from "@/lib/money";
import { clock, ago } from "@/lib/time";
import { printNode } from "@/lib/receipt";
import { PageHeader } from "@/shell/PageHeader";
import { AnimatedMoney, Badge, Button, Card, CardHeader, Dialog, EmptyState, Input, StatTile, useReduced, useToast } from "@/ui";
import { MoneyKeypad } from "./components/bits";
import { OpenShiftDialog } from "./components/OpenShiftDialog";
import { ZReportView } from "./components/ZReportView";
import { ReasonPicker } from "./components/LineSheet";
import { buildZ, cashMove, closeShift, setDeviceCode, zToUnits, type ZReportU } from "./sale";
import { useShift, useStaffNames } from "./usePos";

const DENOMS = [200, 100, 50, 20, 10, 5, 1, 0.5, 0.25];

/** Blind count by denomination. */
function CountDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (u: Units) => void }) {
  const { L, lang } = useT();
  const [n, setN] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) setN({});
  }, [open]);
  const total = DENOMS.reduce((a, d) => a + major(d) * Number(n[d] || 0), 0);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={L("عِد الدرج", "Count the drawer")}
      description={L("عدّ بإيدك قبل ما تشوف المتوقع (عدّ أعمى)", "Count before you see the expected amount (blind count)")}
      footer={
        <Button size="lg" variant="danger" icon={<Lock className="size-5" />} onClick={() => onDone(total)}>
          {L("اقفل الوردية", "Close shift")} · {formatMoney(total, { lang })}
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {DENOMS.map((d) => (
          <label key={d} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5">
            <span className="num w-12 shrink-0 text-[14px] font-semibold text-muted">{d < 1 ? `${d * 100}${L("ق", "pt")}` : d}</span>
            <span className="text-faint">×</span>
            <input value={n[d] ?? ""} onChange={(e) => setN((x) => ({ ...x, [d]: e.target.value.replace(/\D/g, "") }))} inputMode="numeric" aria-label={`${d} EGP`} className="num h-9 w-full min-w-0 rounded-lg bg-surface-2 px-2 text-center text-[16px] outline-none focus:bg-primary-soft" placeholder="0" />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
        <span className="font-semibold text-muted">{L("المعدود", "Counted")}</span>
        <AnimatedMoney value={total} className="text-[26px] font-semibold" />
      </div>
    </Dialog>
  );
}

function MoveDialog({ kind, onClose, onDone }: { kind: CashMoveKind | null; onClose: () => void; onDone: (amount: Units, reason: string) => void }) {
  const { L, lang } = useT();
  const [amount, setAmount] = useState<Units>(0);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (kind) (setAmount(0), setReason(""));
  }, [kind]);
  const reasons =
    kind === "out"
      ? [{ ar: "تلج", en: "Ice" }, { ar: "مواصلات", en: "Transport" }, { ar: "خضار ناقص", en: "Produce top-up" }, { ar: "إيداع بنك", en: "Bank drop" }]
      : kind === "in"
        ? [{ ar: "فكة زيادة", en: "More change" }, { ar: "من المالك", en: "From owner" }]
        : [{ ar: "فكة لعميل", en: "Change for a guest" }, { ar: "تصحيح", en: "Correction" }, { ar: "مراجعة", en: "Check" }];
  return (
    <Dialog
      open={!!kind}
      onClose={onClose}
      size="sm"
      title={kind === "in" ? L("إيداع في الدرج", "Paid in") : kind === "out" ? L("صرف من الدرج", "Paid out") : L("فتح الدرج بدون بيع", "No-sale drawer open")}
      footer={
        <Button size="lg" block disabled={!reason.trim() || (kind !== "no_sale" && !amount)} onClick={() => onDone(amount, reason)}>
          {kind === "no_sale" ? L("افتح الدرج", "Open drawer") : `${L("سجّل", "Record")} ${formatMoney(amount, { lang })}`}
        </Button>
      }
    >
      <div className="grid gap-4">
        {kind !== "no_sale" ? (
          <>
            <div className="rounded-2xl bg-surface-2 px-4 py-2 text-center">
              <AnimatedMoney value={amount} className="text-[28px] font-semibold" />
            </div>
            <MoneyKeypad value={amount} onChange={setAmount} />
          </>
        ) : null}
        <ReasonPicker reasons={reasons} value={reason} onChange={setReason} />
      </div>
    </Dialog>
  );
}

export default function ShiftPage() {
  const { L, lang, loc } = useT();
  const db = useDb();
  const approve = useApproval();
  const { toast } = useToast();
  const { restaurant, staff } = useSession();
  const reduced = useReduced();
  const { device, shift } = useShift();
  const names = useStaffNames();
  const stations = useLive("kitchenStations").data;
  const receipts = useLive("receipts", { where: { shiftId: shift?.id ?? "-" } }, { enabled: !!shift }).data;
  const moves = useLive("cashMovements", { where: { shiftId: shift?.id ?? "-" }, orderBy: [{ field: "createdAt", dir: "desc" }] }, { enabled: !!shift }).data;
  const history = useLive("shifts", { where: { device, status: "closed" }, orderBy: [{ field: "closedAt", dir: "desc" }], limit: 10 }).data;
  const [dlg, setDlg] = useState<null | "open" | "count" | "device" | CashMoveKind>(null);
  const [report, setReport] = useState<{ z: ZReportU; kind: "X" | "Z"; zNumber: number | null; cashier: string | null } | null>(null);
  const [dev, setDev] = useState(device);

  const x = useMemo(() => {
    if (!shift) return null;
    try {
      return zToUnits(buildZ(shift, receipts, moves, null));
    } catch (e) {
      return { error: String((e as Error).message) } as const;
    }
  }, [shift, receipts, moves]);
  const xr = x && !("error" in x) ? x : null;
  const catName = (id: string) => (stations.find((s) => s.id === id) ? loc(stations.find((s) => s.id === id)!.name) : id === "food" ? L("أكل", "Food") : id);

  const doMove = async (kind: CashMoveKind, amount: Units, reason: string) => {
    if (!shift) return;
    let approver: string | null = null;
    if (kind === "no_sale") {
      const who = await approve({ kind: "drawer.open", noSale: true }, L("فتح الدرج بدون بيع", "No-sale drawer open"));
      if (!who) return;
      approver = who.id;
    }
    await cashMove(db, shift, kind, amount, reason, approver);
    setDlg(null);
    toast({ title: kind === "no_sale" ? L("الدرج اتفتح واتسجل", "Drawer opened (logged)") : L("اتسجلت", "Recorded"), tone: "success" });
  };
  const close = async (counted: Units) => {
    if (!shift) return;
    setDlg(null);
    try {
      const r = await closeShift(db, shift, counted);
      setReport({ z: r.z, kind: "Z", zNumber: r.zNumber, cashier: staff?.name ?? null });
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    }
  };
  const print = () => report && restaurant && printNode(<ZReportView z={report.z} kind={report.kind} zNumber={report.zNumber} restaurant={restaurant.name} cashier={report.cashier} lang={lang} categoryName={catName} />, "80");

  return (
    <div className="grid gap-6">
      <PageHeader
        icon={<Wallet />}
        kicker={
          <Link to="/pos" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3.5 flip-rtl" /> {L("الكاشير", "POS")}
          </Link>
        }
        title={L("الوردية والدرج", "Shift & drawer")}
        subtitle={
          <button type="button" className="hover:underline" onClick={() => (setDev(device), setDlg("device"))}>
            {L("الجهاز", "Device")} <span className="num font-semibold">{device}</span> · {L("غيّر", "change")}
          </button>
        }
        actions={
          shift ? (
            <>
              <Button variant="secondary" icon={<FileBarChart2 className="size-4" />} disabled={!xr} onClick={() => xr && setReport({ z: xr, kind: "X", zNumber: null, cashier: shift.openedBy ? (names.get(shift.openedBy)?.name ?? null) : null })}>
                {L("تقرير X", "X report")}
              </Button>
              <Button variant="danger" icon={<Lock className="size-4" />} onClick={() => setDlg("count")}>
                {L("اقفل الوردية (Z)", "Close shift (Z)")}
              </Button>
            </>
          ) : (
            <Button variant="brass" icon={<Wallet className="size-4" />} onClick={() => setDlg("open")}>
              {L("افتح وردية", "Open shift")}
            </Button>
          )
        }
      />

      {shift && xr ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile index={0} icon={<Banknote />} label={L("المتوقع في الدرج", "Expected in drawer")} value={<AnimatedMoney value={xr.cash.expected} />} sub={`${L("فكة", "float")} ${formatMoney(xr.cash.opening, { lang })}`} />
            <StatTile index={1} icon={<FileBarChart2 />} tone="brass" label={L("مبيعات الوردية", "Shift sales")} value={<AnimatedMoney value={xr.sales.total} />} sub={`${xr.sales.count} ${L("إيصال", "receipts")}`} />
            <StatTile index={2} icon={<ArrowDownToLine />} tone="info" label={L("كارت ومحافظ", "Card & wallets")} value={<AnimatedMoney value={(xr.byMethod.card ?? 0) + (xr.byMethod.wallet ?? 0) + (xr.byMethod.instapay ?? 0)} />} sub={`${L("إكراميات", "tips")} ${formatMoney(xr.tips, { lang })}`} />
            <StatTile index={3} icon={<ArrowUpFromLine />} tone="warn" label={L("مرتجعات وصرف", "Refunds & paid out")} value={<AnimatedMoney value={xr.cash.refunds + xr.cash.moveOut} />} sub={`${xr.returns.count} ${L("مرتجع", "returns")}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                title={L("حركة الدرج", "Drawer activity")}
                subtitle={`${L("من", "since")} ${clock(shift.openedAt, lang)} · ${shift.openedBy ? names.get(shift.openedBy)?.name : ""}`}
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" icon={<ArrowDownToLine className="size-4" />} onClick={() => setDlg("in")}>
                      {L("إيداع", "Paid in")}
                    </Button>
                    <Button size="sm" variant="secondary" icon={<ArrowUpFromLine className="size-4" />} onClick={() => setDlg("out")}>
                      {L("صرف", "Paid out")}
                    </Button>
                    <Button size="sm" variant="secondary" icon={<PackageOpen className="size-4" />} onClick={() => setDlg("no_sale")}>
                      {L("بدون بيع", "No sale")}
                    </Button>
                  </div>
                }
              />
              {moves.length ? (
                <ul className="divide-y divide-line">
                  {moves.map((m) => (
                    <motion.li key={m.id} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 px-5 py-3">
                      <span className={cn("grid size-9 place-items-center rounded-xl", m.kind === "in" ? "bg-ok-soft text-ok" : m.kind === "out" ? "bg-warn-soft text-warn" : "bg-surface-3 text-ink-2")}>
                        {m.kind === "in" ? <ArrowDownToLine className="size-4" /> : m.kind === "out" ? <ArrowUpFromLine className="size-4" /> : <PackageOpen className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{m.reason}</span>
                        <span className="block text-[12.5px] text-muted">
                          {ago(m.createdAt, lang)} · {m.actorId ? names.get(m.actorId)?.name : ""}
                          {m.approvedBy ? ` · ✓ ${names.get(m.approvedBy)?.name ?? ""}` : ""}
                        </span>
                      </span>
                      {m.kind !== "no_sale" ? <span className={cn("num font-semibold", m.kind === "out" && "text-warn")}>{formatMoney(m.kind === "out" ? -m.amount : m.amount, { lang, signed: true })}</span> : <Badge size="sm">{L("مسجّل", "logged")}</Badge>}
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact icon={<PackageOpen />} title={L("مفيش حركة لسه", "No drawer activity yet")} />
              )}
            </Card>
            <Card>
              <CardHeader title={L("بطريقة الدفع", "By tender")} />
              <dl className="grid gap-2 px-5 pb-5">
                {Object.entries(xr.byMethod).map(([m, v]) => (
                  <div key={m} className="flex items-center justify-between">
                    <dt className="text-muted">{({ cash: L("كاش", "Cash"), card: L("فيزا", "Card"), wallet: L("محفظة", "Wallet"), instapay: L("إنستاباي", "InstaPay"), aggregator: L("تطبيقات", "Apps"), house: L("آجل", "House") } as Record<string, string>)[m] ?? m}</dt>
                    <dd className="num font-semibold">{formatMoney(v, { lang })}</dd>
                  </div>
                ))}
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                  <dt className="font-semibold">{L("ضريبة ق.م", "VAT")}</dt>
                  <dd className="num font-semibold">{formatMoney(xr.vatDue, { lang })}</dd>
                </div>
              </dl>
            </Card>
          </div>
        </>
      ) : shift && x && "error" in x ? (
        <Card className="p-6 text-danger">{x.error}</Card>
      ) : (
        <EmptyState icon={<Wallet />} title={L("مفيش وردية مفتوحة على الجهاز ده", "No open shift on this device")} body={L("افتح وردية بالفكة اللي في الدرج عشان تبدأ تقبض.", "Open a shift with the float in the drawer to start taking payments.")} action={<Button variant="brass" onClick={() => setDlg("open")}>{L("افتح وردية", "Open shift")}</Button>} />
      )}

      {history.length ? (
        <Card>
          <CardHeader title={L("ورديات سابقة", "Previous shifts")} subtitle={L("تقارير Z", "Z reports")} />
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-5 py-3">
                <span className="num grid size-10 place-items-center rounded-xl bg-surface-3 font-bold">Z{h.zNumber}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {clock(h.openedAt, lang)} → {h.closedAt ? clock(h.closedAt, lang) : ""}
                  </span>
                  <span className="block text-[12.5px] text-muted">{h.closedBy ? names.get(h.closedBy)?.name : ""}</span>
                </span>
                {h.difference != null ? <Badge tone={h.difference === 0 ? "ok" : h.difference > 0 ? "info" : "danger"}>{formatMoney(h.difference, { lang, signed: true })}</Badge> : null}
                <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => h.zReport && setReport({ z: h.zReport as unknown as ZReportU, kind: "Z", zNumber: h.zNumber, cashier: h.closedBy ? (names.get(h.closedBy)?.name ?? null) : null })}>
                  {L("اعرض", "View")}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <OpenShiftDialog open={dlg === "open"} onClose={() => setDlg(null)} device={device} onOpened={() => setDlg(null)} />
      <CountDialog open={dlg === "count"} onClose={() => setDlg(null)} onDone={(u) => void close(u)} />
      <MoveDialog kind={dlg === "in" || dlg === "out" || dlg === "no_sale" ? dlg : null} onClose={() => setDlg(null)} onDone={(a, r) => void doMove(dlg as CashMoveKind, a, r)} />
      <Dialog
        open={dlg === "device"}
        onClose={() => setDlg(null)}
        size="sm"
        title={L("كود الجهاز", "Device code")}
        description={L("بيظهر على الإيصالات وبيفصل تسلسل كل جهاز. غيّره بس لو الجهاز ده جديد.", "Printed on receipts; each device has its own sequence. Change it only on a new device.")}
        footer={
          <Button
            onClick={() => {
              setDeviceCode(dev);
              setDlg(null);
              location.reload();
            }}
            disabled={!!shift}
          >
            {L("حفظ", "Save")}
          </Button>
        }
      >
        <Input value={dev} onChange={(e) => setDev(e.target.value.toUpperCase())} maxLength={8} dir="ltr" hint={shift ? L("اقفل الوردية الأول", "Close the shift first") : undefined} />
      </Dialog>
      <Dialog
        open={!!report}
        onClose={() => setReport(null)}
        size="md"
        title={report?.kind === "Z" ? L(`تقرير Z رقم ${report.zNumber}`, `Z report #${report.zNumber}`) : L("تقرير X", "X report")}
        description={report?.kind === "Z" && report.z.cash.difference != null ? (report.z.cash.difference === 0 ? L("الدرج مظبوط", "Drawer balanced") : report.z.cash.difference > 0 ? L(`زيادة ${formatMoney(report.z.cash.difference, { lang })}`, `Over by ${formatMoney(report.z.cash.difference, { lang })}`) : L(`عجز ${formatMoney(-report.z.cash.difference, { lang })}`, `Short by ${formatMoney(-report.z.cash.difference, { lang })}`)) : undefined}
        footer={
          <Button size="lg" icon={<Printer className="size-5" />} onClick={print}>
            {L("اطبع", "Print")}
          </Button>
        }
      >
        <div className="rounded-2xl bg-surface-3 p-4">
          <div className="mx-auto w-fit shadow-sf-lg">{report && restaurant ? <ZReportView z={report.z} kind={report.kind} zNumber={report.zNumber} restaurant={restaurant.name} cashier={report.cashier} lang={lang} categoryName={catName} /> : null}</div>
        </div>
      </Dialog>
    </div>
  );
}

/** Manual aggregator order (Talabat, elmenus…): channel tag + their reference + commission %, then items in the POS. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Receipt } from "lucide-react";
import { useDb } from "@/data/hooks";
import type { AggregatorId } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { latinDigits } from "@/lib/arabic";
import { Button, Dialog, Input, Switch, useToast } from "@/ui";
import { AGGREGATORS, aggregatorInfo } from "./aggregators";
import { createAggregatorOrder } from "./entry";

export function AggregatorOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L, loc } = useT();
  const db = useDb();
  const nav = useNavigate();
  const { toast } = useToast();
  const [id, setId] = useState<AggregatorId>("talabat");
  const [ref, setRef] = useState("");
  const [pct, setPct] = useState("22");
  const [theirRider, setTheirRider] = useState(true);
  const [prep, setPrep] = useState("15");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const a = aggregatorInfo(id);
    if (a) {
      setPct(String(a.commissionBps / 100));
      setTheirRider(a.theirRiderDefault);
    }
  }, [id]);
  useEffect(() => {
    if (!open) setRef("");
  }, [open]);
  const bps = Math.round(Number(latinDigits(pct)) * 100);
  const ok = ref.trim().length > 0 && Number.isFinite(bps) && bps >= 0 && bps <= 10_000;
  const go = async () => {
    setBusy(true);
    try {
      const { checkId, order } = await createAggregatorOrder(db, { aggregator: id, ref, commissionBps: bps, theirRider, customer: null, address: null, prepMin: Number(prep) || 15 });
      toast({ title: L(`#${order.number} (${ref}) اتفتح — ضيف الأصناف`, `#${order.number} (${ref}) opened — add the items`), tone: "success" });
      onClose();
      nav(`/pos?check=${checkId}`);
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={L("طلب من تطبيق توصيل", "Delivery-app order")}
      description={L("لحد ما الربط يتفعّل: سجّل طلبات التطبيقات هنا عشان المطبخ والمخزون والتقارير تبقى كاملة", "Until integration is enabled, key app orders in so kitchen, stock and reports stay complete")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {L("إلغاء", "Cancel")}
          </Button>
          <Button icon={<Receipt />} disabled={!ok} loading={busy} onClick={go}>
            {L("كمّل في الكاشير", "Continue in POS")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={L("التطبيق", "App")}>
          {AGGREGATORS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={id === a.id} onClick={() => setId(a.id)} className={cn("grid h-16 place-items-center gap-1 rounded-2xl border-2 px-2 text-[13px] font-bold transition-colors", id === a.id ? "border-primary bg-primary-soft" : "border-line hover:border-line-strong")}>
              <span className="size-3 rounded-full" style={{ background: a.color }} aria-hidden />
              {loc(a.name)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label={L("رقم الطلب عندهم", "Their order no.")} value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" placeholder="TB-58213" data-autofocus />
          <Input label={L("العمولة ٪", "Commission %")} value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" dir="ltr" />
        </div>
        <Input label={L("وقت التجهيز (دقيقة)", "Prep time (min)")} value={prep} onChange={(e) => setPrep(latinDigits(e.target.value))} inputMode="numeric" dir="ltr" />
        <Switch checked={theirRider} onChange={setTheirRider} label={L("مندوب التطبيق هيستلم من الفرع", "Their rider collects at the counter")} description={L("مقفول = طيارينا يوصلوه", "Off = our riders deliver it")} />
      </div>
    </Dialog>
  );
}

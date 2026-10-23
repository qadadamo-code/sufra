/** Receipt preview with paper switch (58/80 mm, A4) and print. */
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Printer, ShieldAlert, ShieldCheck } from "lucide-react";
import type { InvoiceDesign } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { printNode, ReceiptView, type ReceiptModel } from "@/lib/receipt";
import { Button, Dialog, Segmented, useHotkeys, useReduced } from "@/ui";

export function ReceiptDialog({ open, onClose, model, title, etaError, actions }: { open: boolean; onClose: () => void; model: ReceiptModel | null; title?: string; etaError?: string | null; actions?: ReactNode }) {
  const { L } = useT();
  const reduced = useReduced();
  const [paper, setPaper] = useState<InvoiceDesign["paper"]>("80");
  useEffect(() => {
    if (open && model) setPaper(model.design.paper);
  }, [open, model?.design.paper]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = model ? { ...model, design: { ...model.design, paper } } : null;
  const print = () => m && printNode(<ReceiptView model={m} />, paper);
  useHotkeys({ "mod+p": (e) => (e.preventDefault(), print()) }, { enabled: open });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={paper === "a4" ? "xl" : "md"}
      title={title ?? L("الإيصال", "Receipt")}
      footer={
        <>
          {actions}
          <Button size="lg" icon={<Printer className="size-5" />} onClick={print} data-autofocus>
            {L("اطبع", "Print")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Segmented label={L("مقاس الورق", "Paper")} value={paper} onChange={setPaper} options={[{ value: "58", label: "58mm" }, { value: "80", label: "80mm" }, { value: "a4", label: "A4" }]} />
        {m?.eta ? (
          <p className="flex items-center gap-2 rounded-xl bg-ok-soft px-3 py-2 text-[13px] font-medium text-ok">
            <ShieldCheck className="size-4 shrink-0" /> {L("إيصال إلكتروني متسلسل — في طابور الإرسال لمصلحة الضرائب", "Chained e-receipt — queued for the Tax Authority")}
          </p>
        ) : null}
        {etaError ? (
          <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] font-medium text-warn">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {L("الإيصال الإلكتروني ماتعملش:", "E-receipt not issued:")} {etaError}
          </p>
        ) : null}
        <div className="overflow-x-auto rounded-2xl bg-surface-3 p-4 thin-scrollbar">
          {m ? (
            <motion.div key={paper} initial={reduced ? false : { opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-fit shadow-sf-lg">
              <ReceiptView model={m} />
            </motion.div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

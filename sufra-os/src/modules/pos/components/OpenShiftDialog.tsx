/** Open a shift on this device with the counted float. */
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useDb } from "@/data/hooks";
import type { Shift } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, major, type Units } from "@/lib/money";
import { AnimatedMoney, Button, Dialog, useToast } from "@/ui";
import { MoneyKeypad } from "./bits";
import { openShift } from "../sale";

export function OpenShiftDialog({ open, onClose, device, onOpened }: { open: boolean; onClose: () => void; device: string; onOpened?: (s: Shift) => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [float, setFloat] = useState<Units>(major(500));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setFloat(major(500));
  }, [open]);
  const go = async () => {
    setBusy(true);
    try {
      const s = await openShift(db, device, float);
      toast({ title: L("الوردية اتفتحت", "Shift opened"), description: `${device} · ${formatMoney(float, { lang })}`, tone: "success" });
      onOpened?.(s);
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
      size="sm"
      title={L("افتح وردية", "Open shift")}
      description={L(`الجهاز ${device} — عِد الفكة اللي في الدرج`, `Device ${device} — count the float in the drawer`)}
      footer={
        <Button size="lg" block loading={busy} onClick={go} icon={<Wallet className="size-5" />}>
          {L("افتح بـ", "Open with")} {formatMoney(float, { lang })}
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="rounded-2xl bg-surface-2 px-4 py-3 text-center">
          <div className="text-[12.5px] font-semibold text-muted">{L("الفكة", "Opening float")}</div>
          <AnimatedMoney value={float} className="text-[32px] font-semibold" />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {[0, 300, 500, 1000, 2000].map((v) => (
            <button key={v} type="button" onClick={() => setFloat(major(v))} className={cn("num h-10 rounded-full border px-3.5 font-semibold", float === major(v) ? "border-primary bg-primary text-primary-ink" : "border-line hover:bg-surface-2")}>
              {v}
            </button>
          ))}
        </div>
        <MoneyKeypad value={float} onChange={setFloat} />
      </div>
    </Dialog>
  );
}


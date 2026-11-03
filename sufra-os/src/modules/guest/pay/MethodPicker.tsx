/** Guest-facing choice of payment method (card / wallet / Apple Pay / mada / STC Pay …) before the hosted checkout. */
import { Apple, Banknote, CreditCard, Landmark, Smartphone, Store, Wallet } from "lucide-react";
import type { OnlineMethod } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { METHOD_SHORT } from "@/modules/payments/config";

const ICON: Record<OnlineMethod, typeof CreditCard> = { card: CreditCard, wallet: Smartphone, kiosk: Store, applepay: Apple, mada: Landmark, stcpay: Wallet, meeza: CreditCard, valu: Banknote };

export function MethodPicker({ methods, value, onChange, className }: { methods: OnlineMethod[]; value: OnlineMethod | null; onChange: (m: OnlineMethod) => void; className?: string }) {
  const { L, loc } = useT();
  if (methods.length < 2) return null;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <span className="px-1 text-[12.5px] font-semibold text-muted">{L("هتدفع بإيه؟", "Pay with")}</span>
      <div role="radiogroup" aria-label={L("طريقة الدفع", "Payment method")} className="flex gap-2 overflow-x-auto no-scrollbar">
        {methods.map((m) => {
          const Icon = ICON[m];
          const on = value === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(m)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 rounded-2xl border-2 px-3.5 text-[13.5px] font-semibold transition-colors",
                on ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink-2 hover:border-line-strong",
                m === "applepay" && on && "border-ink bg-ink text-bg",
              )}
            >
              <Icon className="size-[18px]" />
              {loc(METHOD_SHORT[m])}
            </button>
          );
        })}
      </div>
    </div>
  );
}

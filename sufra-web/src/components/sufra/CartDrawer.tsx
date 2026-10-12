import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { byId, itemIndex } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { egp, formatMoney, priceBreakdown } from "@/lib/pricing";
import { navigate } from "@/lib/router";
import { cartAdd, cartClear, useStore } from "@/lib/store";
import { setUI, useUI } from "@/lib/ui-state";
import { Photo } from "./Photo";

export function CartDrawer() {
  const { L, lang, dir } = useLang();
  const open = useUI((u) => u.cartOpen);
  const cart = useStore((s) => s.cart);
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setUI({ cartOpen: false });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open]);
  const r = cart ? byId[cart.rid] : null;
  const lines = cart?.lines.map((l) => ({ ...l, ...itemIndex[l.itemId] })).filter((l) => l.item) ?? [];
  const b = priceBreakdown({ lines: lines.map((l) => ({ unitPrice: egp(l.item.price), qty: l.qty })), mode: "pickup", vatRate: 0 });
  const from = dir === "rtl" ? "-100%" : "100%";
  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[57]">
          <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={L("السلة", "Cart")}
            className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col bg-background shadow-2xl outline-none"
            initial={reduced ? { opacity: 0 } : { x: from }}
            animate={reduced ? { opacity: 1 } : { x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: from }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
          >
            <div className="flex items-center justify-between border-b px-4 py-4">
              <div>
                <h2 className="text-xl font-bold">{L("السلة", "Your cart")}</h2>
                {r ? <p className="text-sm text-muted-foreground">{L("من", "from")} <a className="font-semibold text-primary underline-offset-4 hover:underline" href={`#/r/${r.slug}`} onClick={close}>{r[lang]}</a></p> : null}
              </div>
              <button type="button" onClick={close} className="grid size-10 place-items-center rounded-full hover:bg-card" aria-label={L("إغلاق", "Close")}>
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {!lines.length ? (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div>
                  <span className="mx-auto grid size-16 place-items-center rounded-full bg-card">
                    <ShoppingBag className="size-7 text-muted-foreground" aria-hidden />
                  </span>
                  <p className="mt-4 font-display text-xl font-semibold">{L("السلة فاضية", "Your cart is empty")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{L("افتح أي مطعم وضيف من المنيو.", "Open any restaurant and add from its menu.")}</p>
                  <a href="#/explore" onClick={close} className="sf-btn sf-btn-primary mt-5">{L("استكشف المطاعم", "Explore restaurants")}</a>
                </div>
              </div>
            ) : (
              <>
                <ul className="flex-1 divide-y overflow-y-auto px-4">
                  {lines.map((l) => (
                    <li key={l.itemId} className="flex items-center gap-3 py-3">
                      <Photo k={l.item.img} label={l.item[lang]} className="size-16 shrink-0 rounded-xl" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{l.item[lang]}</p>
                        <p className="num text-sm text-muted-foreground">{formatMoney(egp(l.item.price) * l.qty, lang)}</p>
                      </div>
                      <div className="flex items-center gap-1 rounded-full border bg-card p-1">
                        <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-muted" onClick={() => cartAdd(cart!.rid, l.itemId, -1)} aria-label={L(`قلل ${l.item.ar}`, `Remove one ${l.item.en}`)}>
                          {l.qty === 1 ? <Trash2 className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
                        </button>
                        <span className="num w-6 text-center font-semibold" aria-live="polite">{l.qty}</span>
                        <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-muted" onClick={() => cartAdd(cart!.rid, l.itemId, 1)} aria-label={L(`زوّد ${l.item.ar}`, `Add one ${l.item.en}`)}>
                          <Plus className="size-4" aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="border-t p-4">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{L("المجموع قبل الضريبة والخدمة", "Subtotal before tax & service")}</span>
                    <span className="num text-base font-semibold text-foreground">{formatMoney(b.subtotal, lang)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{L("الضريبة 14٪ والخدمة والتوصيل بيتحسبوا في الخطوة الجاية.", "14% VAT, service and delivery are added at checkout.")}</p>
                  <div className="mt-4 flex gap-2">
                    <button type="button" className="sf-btn sf-btn-ghost" onClick={cartClear}>{L("فضّي السلة", "Clear")}</button>
                    <button
                      type="button"
                      className="sf-btn sf-btn-primary flex-1"
                      onClick={() => {
                        close();
                        navigate("/checkout");
                      }}
                    >
                      {L("كمّل الطلب", "Checkout")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

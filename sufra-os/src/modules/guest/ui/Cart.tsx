import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ShoppingBag, Trash2 } from "lucide-react";
import { useT } from "@/i18n/i18n";
import type { OrderMode } from "@/data/types";
import type { Units } from "@/lib/money";
import { AnimatedMoney, Button, Dialog, EmptyState, Money, useReduced } from "@/ui";
import { itemImage } from "../data/images";
import { cartCount, cartTotals, lineTotal } from "../cart";
import { useGuest } from "./context";
import { Photo, QtyStepper, TotalsList } from "./bits";

/** Floating "view order" bar — springs up when the cart has something. */
export function CartBar({ onOpen, mode, deliveryFee, offset = 0 }: { onOpen: () => void; mode: OrderMode; deliveryFee?: Units; offset?: number }) {
  const { cart, menu, venue } = useGuest();
  const { L } = useT();
  const reduced = useReduced();
  const n = cartCount(cart);
  const totals = cartTotals(menu, cart, { mode, tax: venue.tax, deliveryFee });
  return (
    <AnimatePresence>
      {n > 0 ? (
        <motion.div
          className="pointer-events-none fixed inset-x-0 z-30 px-4"
          style={{ bottom: `calc(env(safe-area-inset-bottom) + ${12 + offset}px)` }}
          initial={reduced ? { opacity: 0 } : { y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: 90, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        >
          <button
            type="button"
            onClick={onOpen}
            className="pointer-events-auto mx-auto flex h-16 w-full max-w-2xl items-center gap-3 rounded-[22px] bg-primary px-4 text-primary-ink shadow-sf-lg transition active:scale-[0.985]"
          >
            <span className="relative grid size-10 place-items-center rounded-full bg-white/15">
              <ShoppingBag className="size-5" />
              <motion.span key={n} initial={reduced ? false : { scale: 1.5 }} animate={{ scale: 1 }} className="num absolute -top-1 -end-1 grid size-5.5 place-items-center rounded-full bg-brass text-[12px] font-bold text-brass-ink">
                {n}
              </motion.span>
            </span>
            <span className="flex-1 text-start text-[16px] font-bold">{L("شوف طلبك", "View order")}</span>
            <AnimatedMoney value={totals.total} className="text-[16px] font-bold" />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** The cart: lines with steppers, the @finance/tax breakdown, and the next action. */
export function CartSheet({ open, onClose, mode, deliveryFee, children, action, footerNote }: { open: boolean; onClose: () => void; mode: OrderMode; deliveryFee?: Units; children?: ReactNode; action: ReactNode; footerNote?: ReactNode }) {
  const { cart, menu, venue, setLineQty, clearCart } = useGuest();
  const { L, loc } = useT();
  const totals = cartTotals(menu, cart, { mode, tax: venue.tax, deliveryFee });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={L("طلبك", "Your order")}
      description={cart.length ? L(`${cartCount(cart)} صنف`, `${cartCount(cart)} items`) : undefined}
      size="md"
      variant="auto"
      footer={cart.length ? <div className="grid w-full gap-2">{action}{footerNote}</div> : undefined}
    >
      {!cart.length ? (
        <EmptyState compact icon={<ShoppingBag />} title={L("السلة فاضية", "Your cart is empty")} body={L("اختار من المنيو وضيف للطلب", "Pick something from the menu")} action={<Button variant="secondary" onClick={onClose}>{L("ارجع للمنيو", "Back to menu")}</Button>} />
      ) : (
        <div className="grid gap-5 pb-1">
          <ul className="grid divide-y divide-line">
            <AnimatePresence initial={false}>
              {cart.map((l) => {
                const it = menu.items.find((i) => i.id === l.itemId);
                if (!it) return null;
                const mods = l.modifierIds.map((id) => menu.modifiers.find((m) => m.id === id)).filter(Boolean);
                return (
                  <motion.li key={l.key} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="flex gap-3 py-3">
                    <Photo src={itemImage(it)} alt="" className="size-16 shrink-0 rounded-2xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-bold leading-snug">{loc(it.name)}</p>
                        <Money value={lineTotal(menu, l)} className="text-[14.5px] font-semibold" />
                      </div>
                      {mods.length ? <p className="mt-0.5 text-[12.5px] text-muted">{mods.map((m) => loc(m!.name)).join(" · ")}</p> : null}
                      {l.notes ? <p className="mt-0.5 text-[12.5px] italic text-muted">“{l.notes}”</p> : null}
                      <div className="mt-2">
                        <QtyStepper value={l.qty} onChange={(v) => setLineQty(l.key, v)} label={L("الكمية", "Quantity")} size="sm" />
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          <button type="button" onClick={clearCart} className="inline-flex items-center gap-1.5 justify-self-start text-[13px] font-semibold text-muted hover:text-danger">
            <Trash2 className="size-4" />
            {L("فضّي السلة", "Clear cart")}
          </button>
          {children}
          <div className="rounded-2xl bg-surface-2 p-4">
            <TotalsList totals={totals} serviceRate={mode === "dine_in" ? venue.tax.serviceRate : undefined} vatRate={venue.tax.vatRate} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

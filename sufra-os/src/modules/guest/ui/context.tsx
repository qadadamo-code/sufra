import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { UtensilsCrossed } from "lucide-react";
import { useRepo } from "@/data/hooks";
import type { GuestMenu } from "@/data/repo";
import { useT } from "@/i18n/i18n";
import { EmptyState, Skeleton } from "@/ui";
import { GuestService, type Venue } from "../api/service";
import { addLine, loadCart, pruneUnavailable, saveCart, setQty, type CartLine } from "../cart";

interface GuestCtxValue {
  slug: string;
  tableCode: string | null;
  menu: GuestMenu;
  venue: Venue;
  svc: GuestService;
  cart: CartLine[];
  add: (l: Omit<CartLine, "key">) => void;
  setLineQty: (key: string, qty: number) => void;
  clearCart: () => void;
  refresh: () => void;
}

const Ctx = createContext<GuestCtxValue | null>(null);

export function useGuest() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useGuest outside GuestProvider");
  return c;
}

export function useGuestService() {
  const repo = useRepo();
  return useMemo(() => new GuestService(repo), [repo]);
}

/** Loads menu + venue once, keeps them live (86'd items disappear from carts), owns the cart. */
export function GuestProvider({ slug, tableCode, children, fallback }: { slug: string; tableCode: string | null; children: ReactNode; fallback?: ReactNode }) {
  const svc = useGuestService();
  const { t } = useT();
  const [data, setData] = useState<{ menu: GuestMenu; venue: Venue } | null | undefined>(undefined);
  const scope = tableCode ? `t.${tableCode.toUpperCase()}` : "online";
  const [cart, setCart] = useState<CartLine[]>(() => loadCart(slug, scope));
  const seq = useRef(0);

  const load = useCallback(() => {
    const my = ++seq.current;
    Promise.all([svc.menu(slug, tableCode), svc.venue(slug, tableCode)]).then(
      ([menu, venue]) => {
        if (my !== seq.current) return;
        setData(menu && venue ? { menu, venue } : null);
        if (menu) setCart((c) => pruneUnavailable(menu, c));
      },
      () => my === seq.current && setData(null),
    );
  }, [svc, slug, tableCode]);

  useEffect(load, [load]);
  const rid = data?.venue.restaurantId;
  useEffect(() => {
    if (!rid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = svc.watch(rid, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 400);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [svc, rid, load]);

  useEffect(() => saveCart(slug, scope, cart), [slug, scope, cart]);

  const value = useMemo<GuestCtxValue | null>(
    () =>
      data
        ? {
            slug,
            tableCode,
            menu: data.menu,
            venue: data.venue,
            svc,
            cart,
            add: (l) => setCart((c) => addLine(c, l)),
            setLineQty: (key, qty) => setCart((c) => setQty(c, key, qty)),
            clearCart: () => setCart([]),
            refresh: load,
          }
        : null,
    [data, slug, tableCode, svc, cart, load],
  );

  if (data === undefined) return <>{fallback ?? <MenuSkeleton />}</>;
  if (!value)
    return (
      <div className="grid min-h-dvh place-items-center bg-bg p-4">
        <EmptyState icon={<UtensilsCrossed />} title={t("guest.notFound")} body={t("guest.notFoundBody")} />
      </div>
    );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function MenuSkeleton() {
  return (
    <div className="min-h-dvh bg-bg">
      <Skeleton className="h-56 w-full" rounded="rounded-none" />
      <div className="mx-auto grid max-w-2xl gap-3 p-4">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-24" rounded="rounded-full" />
          ))}
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28" rounded="rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

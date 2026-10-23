import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Check, Coffee, CupSoda, Droplets, HandHelping, Leaf, MessageSquare, Receipt, ScrollText, Sparkles, UtensilsCrossed } from "lucide-react";
import { useRepo } from "@/data/hooks";
import type { GuestMenu } from "@/data/repo";
import type { ServiceCallType } from "@/data/types";
import { useT, type TKey } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Dialog, EmptyState, Money, Skeleton, Textarea, useReduced, useToast } from "@/ui";
import { Mark } from "@/shell/Logo";
import { AuthToggles } from "@/pages/AuthChrome";

const CALLS: { type: ServiceCallType; icon: React.ReactNode }[] = [
  { type: "water", icon: <Droplets /> },
  { type: "napkins", icon: <ScrollText /> },
  { type: "tea", icon: <CupSoda /> },
  { type: "coffee", icon: <Coffee /> },
  { type: "clean_table", icon: <Sparkles /> },
  { type: "bill", icon: <Receipt /> },
  { type: "help", icon: <HandHelping /> },
  { type: "other", icon: <MessageSquare /> },
];

/** Minimal guest layout: QR table menu (/r/:slug/t/:code) and online menu (/r/:slug). Ordering lands in the next wave. */
export default function GuestMenuPage() {
  const { restaurantSlug = "", tableCode } = useParams();
  const repo = useRepo();
  const { t, loc } = useT();
  const { toast } = useToast();
  const reduced = useReduced();
  const [menu, setMenu] = useState<GuestMenu | null | undefined>(undefined);
  const [cat, setCat] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const [sent, setSent] = useState<ServiceCallType | null>(null);
  const sections = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    repo.guest.menu(restaurantSlug, tableCode ?? null).then(setMenu, () => setMenu(null));
  }, [repo, restaurantSlug, tableCode]);

  const byCat = useMemo(() => {
    const m = new Map<string, GuestMenu["items"]>();
    for (const i of menu?.items ?? []) m.set(i.categoryId, [...(m.get(i.categoryId) ?? []), i]);
    return m;
  }, [menu]);

  const call = async (type: ServiceCallType, text = "") => {
    if (!tableCode) return;
    try {
      await repo.guest.callWaiter(restaurantSlug, tableCode, type, text);
      setSent(type);
      setOther(null);
      setTimeout(() => {
        setSent(null);
        setCallOpen(false);
      }, 1600);
    } catch {
      toast({ title: t("toast.error"), tone: "error" });
    }
  };

  if (menu === undefined)
    return (
      <div className="mx-auto grid max-w-2xl gap-3 p-4">
        <Skeleton className="h-40" rounded="rounded-3xl" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" rounded="rounded-2xl" />
        ))}
      </div>
    );
  if (!menu)
    return (
      <div className="grid min-h-dvh place-items-center bg-bg p-4">
        <EmptyState icon={<UtensilsCrossed />} title={t("guest.notFound")} body={t("guest.notFoundBody")} />
      </div>
    );

  const p = menu.pricing;
  return (
    <div className="min-h-dvh bg-bg pb-28">
      <header className="relative overflow-hidden bg-[linear-gradient(160deg,#0d5a53,#08231f)] px-4 pt-4 pb-10 text-[#eef6f3]">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Mark className="size-9" />
          <div className="rounded-full bg-white/10 [&_button]:text-white [&_button:hover]:bg-white/10">
            <AuthToggles />
          </div>
        </div>
        <div className="mx-auto mt-6 max-w-2xl">
          {menu.table ? <Badge className="mb-2 bg-white/15 text-white">{t("common.table", { n: menu.table.label })}</Badge> : null}
          <h1 className="text-[30px] leading-tight">{loc(menu.restaurant.name)}</h1>
          {menu.branch ? <p className="mt-1 text-[14px] text-[#cfe6e0]">{loc(menu.branch.name)}</p> : null}
          <p className="mt-3 max-w-md text-[13.5px] text-[#cfe6e0]">{menu.table ? t("guest.orderingSoon") : t("guest.onlineSoon")}</p>
        </div>
      </header>

      <nav className="sticky top-0 z-20 -mt-5 border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl gap-2 overflow-x-auto px-4 py-3 no-scrollbar">
          {menu.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCat(c.id);
                sections.current.get(c.id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
              }}
              className={cn("h-10 shrink-0 rounded-full border px-4 text-[14px] font-semibold transition-colors", cat === c.id ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:border-line-strong")}
            >
              {loc(c.name)}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto grid max-w-2xl gap-8 px-4 pt-5">
        <p className="text-[12.5px] text-muted">{p.priceMode === "inclusive" ? t("guest.pricesIncl") : t("guest.pricesExcl", { service: p.serviceRate / 100, vat: p.vatRegistered ? p.vatRate / 100 : 0 })}</p>
        {menu.categories.map((c) => (
          <section
            key={c.id}
            ref={(el) => {
              if (el) sections.current.set(c.id, el);
            }}
            className="scroll-mt-20"
          >
            <h2 className="mb-3 text-[22px]">{loc(c.name)}</h2>
            <ul className="grid gap-2.5">
              {(byCat.get(c.id) ?? []).map((i) => (
                <li key={i.id} className={cn("flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-sf-sm", !i.available && "opacity-55")}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[15.5px] font-bold">
                      {loc(i.name)}
                      {i.tags.includes("veg") ? <Leaf className="size-3.5 text-ok" aria-label="veg" /> : null}
                      {i.tags.includes("popular") ? <Badge tone="brass" size="sm">★</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{loc(i.description)}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    {i.available ? <Money value={i.price} compact className="text-[15px] font-semibold" /> : <Badge tone="danger" size="sm">{t("guest.soldOut")}</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="pb-4 text-center text-[12px] text-faint">{t("guest.poweredBy")}</p>
      </main>

      {menu.table && menu.qrOrdering.allowServiceCalls ? (
        <div className="fixed inset-x-0 bottom-0 z-30 p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <div className="mx-auto max-w-2xl">
            <Button size="xl" block variant="brass" icon={<BellRing className="size-6" />} onClick={() => setCallOpen(true)} className="shadow-sf-lg">
              {t("guest.callWaiter")}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={callOpen} onClose={() => (setCallOpen(false), setOther(null))} title={t("guest.whatNeed")} variant="bottom">
        <AnimatePresence mode="wait" initial={false}>
          {sent ? (
            <motion.div key="ok" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-ok text-white">
                <Check className="size-8" strokeWidth={3} />
              </span>
              <p className="text-[18px] font-bold">{t("guest.callSent")}</p>
            </motion.div>
          ) : other !== null ? (
            <motion.form key="other" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-3 pt-1" onSubmit={(e) => (e.preventDefault(), void call("other", other))}>
              <Textarea autoFocus placeholder={t("guest.otherPlaceholder")} value={other} onChange={(e) => setOther(e.target.value)} maxLength={200} />
              <Button type="submit" size="lg" block disabled={!other.trim()}>
                {t("guest.send")}
              </Button>
            </motion.form>
          ) : (
            <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-2 gap-2.5 pt-1 sm:grid-cols-4">
              {CALLS.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  onClick={() => (c.type === "other" ? setOther("") : void call(c.type))}
                  className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface-2 p-3 text-[14px] font-semibold transition-colors active:scale-[0.97] hover:border-primary/40 hover:bg-primary-soft [&_svg]:size-6 [&_svg]:text-primary"
                >
                  {c.icon}
                  {t(`call.${c.type}` as TKey)}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </Dialog>
    </div>
  );
}

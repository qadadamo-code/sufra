import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Database, Sparkles } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { useLive } from "@/data/hooks";
import type { CollectionName } from "@/data/types";
import { cn } from "@/lib/cn";
import { Badge, Card, LinkButton, useReduced } from "@/ui";
import { useCurrentModule } from "./ModuleContext";
import { useSession } from "@/auth/session";
import { homeFor } from "@/modules/registry";

const COLLECTION_LABEL: Partial<Record<CollectionName, { ar: string; en: string }>> = {
  menuItems: { ar: "صنف في المنيو", en: "menu items" },
  menuCategories: { ar: "قسم", en: "categories" },
  modifierGroups: { ar: "مجموعة إضافات", en: "modifier groups" },
  modifiers: { ar: "إضافة", en: "modifiers" },
  checks: { ar: "شيك", en: "checks" },
  payments: { ar: "دفعة", en: "payments" },
  tables: { ar: "ترابيزة", en: "tables" },
  zones: { ar: "منطقة", en: "zones" },
  reservations: { ar: "حجز", en: "reservations" },
  orderItems: { ar: "صنف مطلوب", en: "order lines" },
  orders: { ar: "طلب", en: "orders" },
  kitchenStations: { ar: "محطة مطبخ", en: "kitchen stations" },
  serviceCalls: { ar: "نداء", en: "guest calls" },
  customers: { ar: "زبون", en: "customers" },
  memberships: { ar: "موظف", en: "staff" },
  auditLog: { ar: "سطر في سجل العمليات", en: "audit entries" },
  settings: { ar: "ملف إعدادات", en: "settings profile" },
  printers: { ar: "طابعة", en: "printers" },
};

function DataCount({ c }: { c: CollectionName }) {
  const { data, loading } = useLive(c);
  const { lang } = useT();
  const label = COLLECTION_LABEL[c]?.[lang] ?? c;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
      <Database className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="num min-w-8 text-[17px] font-semibold" dir="ltr">
        {loading ? "…" : data.length}
      </span>
      <span className="text-[14px] text-ink-2">{label}</span>
    </li>
  );
}

/** "Coming in the next wave" page for modules whose status is "soon". */
export function ComingSoon() {
  const ctx = useCurrentModule();
  const { t, loc, dir } = useT();
  const { role } = useSession();
  const reduced = useReduced();
  if (!ctx) return null;
  const { module: m } = ctx;
  const Icon = m.icon;
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const item = (i: number) => (reduced ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.08 + i * 0.06, type: "spring" as const, stiffness: 260, damping: 28 } });

  return (
    <div className="mx-auto w-full max-w-5xl">
      {m.tabs ? (
        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line no-scrollbar" aria-label={loc(m.title)}>
          {m.tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end
              className={({ isActive }) => cn("relative inline-flex h-11 shrink-0 items-center px-3.5 text-[14.5px] font-semibold", isActive ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:rounded-full after:bg-primary" : "text-muted hover:text-ink")}
            >
              {loc(tab.title)}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <div className="relative overflow-hidden rounded-[28px] border border-line bg-surface p-6 shadow-sf sm:p-10">
        {/* soft brand glow + grain */}
        <div className="pointer-events-none absolute -top-32 -end-24 size-[420px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--sf-primary)_22%,transparent),transparent_65%)]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -start-24 size-[380px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--sf-brass)_16%,transparent),transparent_65%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 paper-grain opacity-50" aria-hidden />

        <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-12">
          <div>
            <motion.div {...item(0)} className="relative mb-6 inline-grid size-20 place-items-center">
              {!reduced ? (
                <motion.span
                  className="absolute inset-0 rounded-[26px] border-2 border-dashed border-primary/30"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
                  aria-hidden
                />
              ) : null}
              <span className="grid size-16 place-items-center rounded-[22px] bg-primary text-primary-ink shadow-[0_14px_30px_-12px_var(--sf-primary)]">
                <Icon className="size-8" aria-hidden />
              </span>
            </motion.div>
            <motion.div {...item(1)}>
              <Badge tone="brass" icon={<Sparkles />}>
                {t("soon.badge")}
              </Badge>
            </motion.div>
            <motion.h1 {...item(2)} className="mt-3 text-[30px] leading-tight sm:text-[38px]">
              {t("soon.title", { module: loc(m.title) })}
            </motion.h1>
            <motion.p {...item(3)} className="mt-2 text-[16px] text-ink-2">
              {loc(m.description)}
            </motion.p>
            <motion.p {...item(4)} className="mt-3 max-w-lg text-[14px] text-muted">
              {t("soon.body")}
            </motion.p>
            {m.data?.length ? (
              <motion.div {...item(5)} className="mt-6">
                <p className="mb-2 text-[13px] font-semibold text-muted">{t("soon.data")}</p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {m.data.map((c) => (
                    <DataCount key={c} c={c} />
                  ))}
                </ul>
              </motion.div>
            ) : null}
            {homeFor(role) !== m.nav?.path ? (
            <motion.div {...item(6)} className="mt-7">
              <LinkButton to={homeFor(role)} variant="secondary" iconEnd={<Arrow className="size-4" />}>
                {t("soon.home")}
              </LinkButton>
            </motion.div>
            ) : null}
          </div>

          {m.features?.length ? (
            <Card className="self-start bg-surface-2/70 p-5 backdrop-blur sm:p-6">
              <p className="mb-4 text-[13px] font-semibold text-muted">{t("soon.coming")}</p>
              <ol className="grid gap-4">
                {m.features.map((f, i) => (
                  <motion.li key={i} {...item(3 + i)} className="flex gap-3">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                      <Check className="size-3.5" strokeWidth={3} aria-hidden />
                    </span>
                    <span className="text-[14.5px] leading-relaxed">{loc(f)}</span>
                  </motion.li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

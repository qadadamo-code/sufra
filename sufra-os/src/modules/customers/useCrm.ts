/** Live CRM data for the customers & marketing screens: customers, visit ledger, program, stats + RFM. */
import { useMemo } from "react";
import { useLive } from "@/data/hooks";
import type { Customer } from "@/data/types";
import { customerStatsAll, rulesOf } from "@/modules/marketing/ops";
import { tierFor, type CustomerStats } from "@/lib/promo";

export function useCrm() {
  const customersLive = useLive("customers");
  const ledgerLive = useLive("loyaltyLedger");
  const program = useLive("loyaltyPrograms").data[0] ?? null;
  const segments = useLive("segments").data;
  const customers = useMemo(() => customersLive.data.filter((c) => !c.mergedInto), [customersLive.data]);
  const stats = useMemo(() => customerStatsAll(customers, ledgerLive.data), [customers, ledgerLive.data]);
  const byId = useMemo(() => new Map(stats.map((s) => [s.id, s])), [stats]);
  const rules = rulesOf(program);
  const tierOf = (c: Pick<Customer, "lifetimePoints" | "tierId">) => (c.tierId ? rules.tiers.find((t) => t.id === c.tierId) ?? null : tierFor(c.lifetimePoints ?? 0, rules.tiers));
  return {
    customers,
    all: customersLive.data,
    ledger: ledgerLive.data,
    stats,
    statsOf: (id: string): CustomerStats | undefined => byId.get(id),
    program,
    rules,
    tierOf,
    segments,
    loading: customersLive.loading || ledgerLive.loading,
  };
}

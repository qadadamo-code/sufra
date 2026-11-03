/** Customer reports (pure): new vs returning by month, retention cohorts, redemption rates, campaign ROI. */
import type { Campaign, CouponCode, LoyaltyEntry, Promotion, PromoRedemption } from "@/data/types";
import type { Units } from "@/lib/money";

const month = (iso: string) => iso.slice(0, 7);
export function lastMonths(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Visits per month split by whether it was the guest's first visit. */
export function newVsReturning(visits: Pick<LoyaltyEntry, "customerId" | "at" | "kind">[], months: string[]) {
  const earn = visits.filter((v) => v.kind === "earn").sort((a, b) => a.at.localeCompare(b.at));
  const first = new Map<string, string>();
  for (const v of earn) if (!first.has(v.customerId)) first.set(v.customerId, v.at);
  return months.map((m) => {
    const inMonth = earn.filter((v) => month(v.at) === m);
    const newGuests = new Set(inMonth.filter((v) => first.get(v.customerId) === v.at).map((v) => v.customerId));
    const returning = new Set(inMonth.filter((v) => !newGuests.has(v.customerId)).map((v) => v.customerId));
    return { month: m, new: newGuests.size, returning: returning.size };
  });
}

/** Cohort by first-visit month: share of the cohort that visited again in month +1 … +k. */
export function retentionCohorts(visits: Pick<LoyaltyEntry, "customerId" | "at" | "kind">[], months: string[], k = 5) {
  const earn = visits.filter((v) => v.kind === "earn");
  const byCustomer = new Map<string, string[]>();
  for (const v of earn) byCustomer.set(v.customerId, [...(byCustomer.get(v.customerId) ?? []), month(v.at)]);
  const idx = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return y * 12 + mo;
  };
  return months.map((m) => {
    const cohort = [...byCustomer.entries()].filter(([, ms]) => ms.sort()[0] === m);
    const size = cohort.length;
    const cells = Array.from({ length: k }, (_, i) => {
      const target = idx(m) + i + 1;
      if (target > idx(months[months.length - 1])) return null;
      const back = cohort.filter(([, ms]) => ms.some((x) => idx(x) === target)).length;
      return size ? back / size : 0;
    });
    return { month: m, size, cells };
  });
}

export function redemptionStats(promos: Promotion[], reds: PromoRedemption[], codes: CouponCode[]) {
  return promos
    .map((p) => {
      const r = reds.filter((x) => x.promotionId === p.id && x.status === "redeemed");
      const issued = codes.filter((c) => c.promotionId === p.id).length;
      const used = codes.filter((c) => c.promotionId === p.id && c.usedAt).length;
      const discount = r.reduce((a, x) => a + x.discount + x.deliveryDiscount, 0);
      const revenue = r.reduce((a, x) => a + x.revenue, 0);
      return { id: p.id, name: p.name, uses: Math.max(p.uses, r.length), issued, rate: issued ? used / issued : null, discount, revenue };
    })
    .sort((a, b) => b.uses - a.uses);
}

export function campaignRoi(campaigns: Campaign[]): { id: string; name: string; sent: number; redeemed: number; revenue: Units; cost: Units; roi: number | null; conv: number | null }[] {
  return campaigns
    .filter((c) => c.status === "sent")
    .map((c) => ({ id: c.id, name: c.name, sent: c.stats.sent, redeemed: c.stats.redeemed, revenue: c.stats.revenue, cost: c.stats.cost, roi: c.stats.cost ? c.stats.revenue / c.stats.cost : null, conv: c.stats.sent ? c.stats.redeemed / c.stats.sent : null }))
    .sort((a, b) => b.revenue - a.revenue);
}

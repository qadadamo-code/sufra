/**
 * Delivery aggregators (Talabat, elmenus, HungerStation, Jahez, Keeta).
 *
 * None of them offers a self-serve public API: order injection needs either the aggregator's own partner/POS
 * integration programme (they enable it per restaurant, usually after a contract) or a middleware such as
 * Deliverect / Foodizone / Grubtech that already holds those integrations and pushes orders to us by webhook.
 * Until one is enabled, staff key aggregator orders in by hand (`channel = aggregator`, commission %) so stock,
 * kitchen and reports stay complete.
 *
 * An integration implements `AggregatorAdapter` server-side (api/aggregator-*.ts — needs the partner credentials,
 * never the browser) and turns webhook payloads into `NormalizedOrder`s that are inserted like an online order.
 */
import type { AggregatorId, Localized } from "@/data/types";
import type { Units } from "@/lib/money";

export interface NormalizedOrder {
  aggregator: AggregatorId;
  externalId: string;
  /** their short code printed on the bag */
  displayRef: string;
  placedAt: string;
  customer: { name: string; phone: string | null } | null;
  mode: "delivery" | "takeaway";
  /** true when the aggregator's rider collects at the counter */
  theirRider: boolean;
  address: { text: string; lat: number | null; lng: number | null; notes: string } | null;
  lines: { externalItemId: string; sku: string | null; name: string; qty: number; unitPrice: Units; modifiers: { name: string; price: Units }[]; notes: string }[];
  totals: { subtotal: Units; deliveryFee: Units; discount: Units; total: Units };
  paid: boolean;
  note: string;
}

export type AggregatorStatus = "accepted" | "rejected" | "ready" | "picked_up" | "delivered" | "cancelled";

/** What a server-side integration (direct or via middleware) must provide. */
export interface AggregatorAdapter {
  readonly id: AggregatorId;
  /** verify the webhook signature and parse an order */
  parseWebhook(headers: Record<string, string>, body: string): Promise<NormalizedOrder | null>;
  /** push status back (accept with prep time, reject with reason, ready, …) */
  updateStatus(externalId: string, status: AggregatorStatus, opts?: { prepMin?: number; reason?: string }): Promise<void>;
  /** mark items unavailable on their menu */
  setItemAvailability(skus: string[], available: boolean): Promise<void>;
  /** publish our menu to theirs (where supported) */
  syncMenu?(menu: unknown): Promise<void>;
}

export interface AggregatorInfo {
  id: AggregatorId;
  name: Localized;
  countries: ("EG" | "SA")[];
  color: string;
  /** typical commission, basis points (pre-fill for manual orders) */
  commissionBps: number;
  theirRiderDefault: boolean;
  how: Localized;
  middleware: string[];
}

export const AGGREGATORS: AggregatorInfo[] = [
  {
    id: "talabat", name: { ar: "طلبات", en: "Talabat" }, countries: ["EG"], color: "#ff5a00", commissionBps: 2200, theirRiderDefault: true,
    how: { ar: "التكامل بيتفعّل من مدير الحساب في طلبات (Partner API / POS integration) أو عن طريق Deliverect.", en: "Enabled by your Talabat account manager (partner POS integration) or through Deliverect." },
    middleware: ["Deliverect", "Grubtech"],
  },
  {
    id: "elmenus", name: { ar: "المنيوز", en: "elmenus" }, countries: ["EG"], color: "#e4343f", commissionBps: 1800, theirRiderDefault: false,
    how: { ar: "elmenus بتفعّل الربط مع الـ POS للمطاعم المتعاقدة؛ أو عن طريق Foodizone.", en: "elmenus enables POS integration for contracted restaurants; or via Foodizone." },
    middleware: ["Foodizone"],
  },
  {
    id: "hungerstation", name: { ar: "هنقرستيشن", en: "HungerStation" }, countries: ["SA"], color: "#ffd100", commissionBps: 2000, theirRiderDefault: true,
    how: { ar: "عن طريق برنامج الشركاء في هنقرستيشن أو Deliverect.", en: "Via the HungerStation partner programme or Deliverect." },
    middleware: ["Deliverect", "Grubtech"],
  },
  {
    id: "jahez", name: { ar: "جاهز", en: "Jahez" }, countries: ["SA"], color: "#d4202c", commissionBps: 1900, theirRiderDefault: true,
    how: { ar: "جاهز بتفعّل الـ API للشركاء بعد التعاقد؛ أو عن طريق Foodics/Deliverect.", en: "Jahez enables its partner API after contracting; or via a middleware such as Deliverect." },
    middleware: ["Deliverect"],
  },
  {
    id: "keeta", name: { ar: "كيتا", en: "Keeta" }, countries: ["SA", "EG"], color: "#ffc300", commissionBps: 1800, theirRiderDefault: true,
    how: { ar: "Keeta (ميتوان) بتفتح الربط للمطاعم من بوابة التجار؛ تواصل مع مدير الحساب.", en: "Keeta (Meituan) opens integration from its merchant portal — ask your account manager." },
    middleware: ["Deliverect"],
  },
];

export const aggregatorInfo = (id: AggregatorId | null | undefined) => AGGREGATORS.find((a) => a.id === id) ?? null;

/** Commission on an order total (basis points, rounded to the unit). */
export const commissionOf = (total: Units, bps: number) => Math.round((total * bps) / 10_000);

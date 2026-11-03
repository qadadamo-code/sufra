/**
 * Order-stage notifications — the ONE place a delivery/takeaway stage change tells the customer.
 *
 *   await notifyOrderStage(order, "out_for_delivery", { db });
 *
 * Every staff-side transition (inbox accept/reject, ready, driver picked up / arrived / delivered, delays) calls this.
 * It resolves the customer, driver, ETA and links, renders the WhatsApp template vars, and hands the message to the
 * registered sender. Default sender: the guest `LogNotifier` (preview outbox, deduped per order+stage). The messaging
 * module registers the real WhatsApp Cloud sender at start-up:
 *
 *   import { registerOrderNotifier } from "@/modules/delivery/notify";
 *   registerOrderNotifier(whatsAppNotifier);           // anything with send(OutgoingMessage) (guest Notifier interface)
 *   // or registerStageSender(async (m) => …)          // full StageMessage (order, stage, template, vars…)
 *
 * Dedupe keys are `${orderId}:${stage}` — the same keys the guest tracking page uses, so a customer never gets a stage twice.
 */
import type { Db } from "@/data/hooks";
import type { Customer, Membership, Order, Restaurant } from "@/data/types";
import type { Lang } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { getNotifier, type Notifier, type OutgoingMessage } from "@/modules/guest/notify/notifier";
import { STAGE_TEMPLATE, type NotifyStage, type TemplateId } from "@/modules/guest/notify/templates";
import { dispatchOf } from "./settings";

export type OrderStage = Exclude<NotifyStage, "paid">;

export interface StageMessage extends OutgoingMessage {
  orderId: string;
  stage: OrderStage;
  template: TemplateId;
  order: Order;
}

export type StageSender = (m: StageMessage) => Promise<unknown>;

let sender: StageSender | null = null;

const outgoing = ({ restaurantId, to, lang, template, vars, dedupeKey }: StageMessage): OutgoingMessage => ({ restaurantId, to, lang, template, vars, dedupeKey });

/** Replace the default (log/preview) sender. Returns an unregister function. */
export function registerStageSender(fn: StageSender): () => void {
  sender = fn;
  return () => {
    if (sender === fn) sender = null;
  };
}
/** Same, for anything implementing the guest `Notifier` interface (WhatsApp Cloud, SMS…). */
export function registerOrderNotifier(n: Notifier): () => void {
  return registerStageSender((m) => n.send(outgoing(m)));
}

export interface NotifyContext {
  db: Db;
  /** promised clock time for accepted / out-for-delivery / delayed */
  eta?: string | null;
  reason?: string | null;
  lang?: Lang;
  /** for tests / server rendering */
  origin?: string;
}

const clock = (iso: string, lang: Lang) => new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" });

export function trackingLink(slug: string, orderId: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? `${window.location.origin}${import.meta.env?.BASE_URL ?? "/app/"}` : "https://sufra.app/app/");
  return `${base.replace(/\/?$/, "/")}r/${slug}/o/${orderId}`;
}

/** Template variables for a stage (pure; exported for tests and previews). */
export function stageVars(
  stage: OrderStage,
  x: { order: Order; customer: Pick<Customer, "name" | "phone">; restaurant: Pick<Restaurant, "name" | "phone" | "slug">; branch?: { name: { ar: string; en: string }; address: { ar: string; en: string } } | null; driver?: Pick<Membership, "name" | "phone"> | null; total?: number; paid?: number; lang: Lang; eta?: string | null; reason?: string | null; origin?: string },
): Record<string, string | number> {
  const { order, customer, restaurant, lang } = x;
  const d = dispatchOf(order);
  const link = trackingLink(restaurant.slug, order.id, x.origin);
  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const base = { name: customer.name.split(" ")[0] || customer.name || L("عميلنا", "there"), number: order.number, link };
  const etaIso = x.eta ?? d.promisedAt ?? new Date(Date.parse(order.openedAt) + 45 * 60_000).toISOString();
  const eta = /^\d{1,2}:\d{2}/.test(etaIso) ? etaIso : clock(etaIso, lang);
  const driverName = x.driver?.name.split(" ")[0] ?? L("الطيار", "our rider");
  const driverPhone = x.driver?.phone ?? restaurant.phone ?? "-";
  switch (stage) {
    case "received":
      return { ...base, restaurant: restaurant.name[lang], items: "-", total: x.total ? formatMoney(x.total, { lang }) : "-", payment: (x.paid ?? 0) >= (x.total ?? 1) ? L("مدفوع", "Paid") : L("عند الاستلام", "On delivery") };
    case "accepted":
      return { ...base, eta };
    case "ready_pickup": {
      const addr = x.branch ? x.branch.address[lang] : restaurant.name[lang];
      return { ...base, branch: x.branch ? x.branch.name[lang] : restaurant.name[lang], map_link: `https://maps.google.com/?q=${encodeURIComponent(addr)}` };
    }
    case "out_for_delivery":
      return { ...base, driver_name: driverName, driver_phone: driverPhone, eta };
    case "arriving":
      return { number: order.number, driver_name: driverName, driver_phone: driverPhone };
    case "delivered":
      return { ...base, receipt_link: link, rate_link: `${link}#rate` };
    case "cancelled":
      return {
        ...base,
        reason: x.reason || L("المطعم مش قادر يجهّز الطلب دلوقتي", "The restaurant can't fulfil the order right now"),
        refund: (x.paid ?? 0) > 0 ? L("هيرجعلك المبلغ خلال ٣–٥ أيام عمل", "Your refund will arrive in 3–5 business days") : L("مفيش أي مبلغ اتخصم", "Nothing was charged"),
        phone: restaurant.phone ?? "-",
      };
    case "delayed":
      return { ...base, eta, reason: x.reason || L("ضغط في المطبخ", "The kitchen is busy") };
  }
}

/**
 * Tell the customer about a stage change. Never throws (a failed message must not block the hand-off);
 * returns false when there is no one to tell (no customer phone, dine-in) or the sender failed.
 */
export async function notifyOrderStage(order: Order, stage: OrderStage, ctx: NotifyContext): Promise<boolean> {
  try {
    if (order.mode === "dine_in" || order.source === "qr") return false;
    if (stage === "ready_pickup" && order.mode !== "takeaway") return false;
    const { db } = ctx;
    const customer = order.customerId ? await db.get("customers", order.customerId) : null;
    if (!customer?.phone) return false;
    const [restaurant] = await db.list("restaurants");
    if (!restaurant) return false;
    const branch = await db.get("branches", order.branchId);
    const driver = order.driverId ? await db.get("memberships", order.driverId) : null;
    const check = order.checkId ? await db.get("checks", order.checkId) : null;
    const [settings] = await db.list("settings");
    const lang: Lang = ctx.lang ?? settings?.locale.defaultLang ?? "ar";
    const vars = stageVars(stage, { order, customer, restaurant, branch, driver, total: check?.total, paid: check?.paid, lang, eta: ctx.eta, reason: ctx.reason, origin: ctx.origin });
    const m: StageMessage = { restaurantId: order.restaurantId, to: customer.phone, lang, template: STAGE_TEMPLATE[stage], vars, dedupeKey: stage === "delayed" ? `${order.id}:delayed:${ctx.eta ?? Date.now()}` : `${order.id}:${stage}`, orderId: order.id, stage, order };
    if (sender) await sender(m);
    else await getNotifier().send(outgoing(m));
    return true;
  } catch (e) {
    console.warn("notifyOrderStage", stage, e);
    return false;
  }
}

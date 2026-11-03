/**
 * Wires messaging into the rest of the app:
 *
 *   registerOrderNotifier()   — delivery's notifyOrderStage(order, stage, ctx) now goes through MessagingService
 *                               (consent, dedupe, log, channel from Settings → Messaging), and "delivered" queues
 *                               the feedback request. Called once at start-up from src/modules/messaging/module.tsx.
 *   startAutomation(db)       — staff app: feedback after a paid dine-in check / delivered order, and sending of
 *                               scheduled messages every minute. Started by the inbox badge hook (any open
 *                               owner/manager/cashier screen). In cloud mode a cron/DB trigger can do the same
 *                               server side (see docs/WHATSAPP-SETUP.md).
 */
import { createRepo } from "@/data";
import { makeDb, type Db } from "@/data/hooks";
import type { Repo } from "@/data/repo";
import type { Check, Order } from "@/data/types";
import { loadRaw } from "@/lib/storage";
import { registerStageSender, type StageMessage } from "@/modules/delivery/notify";
import type { NotifierEnv } from "./notifier";
import { MessagingService, rateLink } from "./service";
import { API_KEY_STORAGE } from "./settings";

/** Auth headers for /api/whatsapp-send: the Supabase session JWT, else the device-local SUFRA_API_KEY. */
export function apiAuth(repo: Repo): () => Promise<Record<string, string>> {
  return async (): Promise<Record<string, string>> => {
    const client = (repo as unknown as { client?: { auth?: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> } } }).client;
    if (repo.kind === "supabase" && client?.auth) {
      const { data } = await client.auth.getSession();
      if (data.session?.access_token) return { authorization: `Bearer ${data.session.access_token}` };
    }
    const key = loadRaw(API_KEY_STORAGE);
    return key ? { "x-sufra-api-key": key } : {};
  };
}

export const envFor = (repo: Repo, extra: Partial<NotifierEnv> = {}): NotifierEnv => ({ auth: apiAuth(repo), ...extra });

export async function serviceFor(db: Db, extra: Partial<NotifierEnv> = {}) {
  return MessagingService.load(db, envFor(db.repo, extra));
}

/* ───────── feedback ───────── */

/** Queue "how was it?" N minutes after delivery / a paid visit. Deduped per order. */
export async function queueFeedback(db: Db, order: Order, kind: "delivery" | "visit"): Promise<boolean> {
  if (!order.customerId) return false;
  const svc = await serviceFor(db);
  const f = svc.settings.feedback;
  if (!f.enabled || (kind === "delivery" && !f.afterDelivery) || (kind === "visit" && !f.afterVisit)) return false;
  const customer = await db.get("customers", order.customerId);
  if (!customer?.phone) return false;
  const [settings] = await db.list("settings");
  const lang = settings?.locale.defaultLang ?? "ar";
  const msg = await svc.send({
    to: customer.phone,
    name: customer.name,
    customerId: customer.id,
    template: "feedback_request",
    lang,
    vars: { name: customer.name.split(" ")[0] || customer.name, restaurant: svc.restaurant.name[lang] || svc.restaurant.name.ar, number: order.number, rate_link: rateLink(svc.restaurant.slug, order.id) },
    dedupeKey: `${order.id}:feedback`,
    orderId: order.id,
    transactional: true,
    sendAt: new Date(Date.now() + Math.max(0, f.delayMin) * 60_000).toISOString(),
  });
  return msg.status !== "skipped";
}

/* ───────── delivery stage sender ───────── */

let registered = false;

/** Register our sender with the delivery module (idempotent). */
export function registerOrderNotifier(getRepo: () => Promise<Repo> = createRepo): () => void {
  if (registered) return () => undefined;
  registered = true;
  const off = registerStageSender(async (m: StageMessage) => {
    const repo = await getRepo();
    const db = makeDb(repo, m.restaurantId, m.order.branchId ?? null, null);
    const svc = await serviceFor(db);
    if (svc.settings.autoStages.includes(m.stage)) {
      await svc.send({ to: m.to, template: m.template, lang: m.lang, vars: m.vars, dedupeKey: m.dedupeKey, orderId: m.orderId, transactional: true, customerId: m.order.customerId });
    }
    if (m.stage === "delivered") await queueFeedback(db, m.order, "delivery");
  });
  return () => {
    off();
    registered = false;
  };
}

/* ───────── staff-app automation ───────── */

const running = new Map<string, () => void>();

/** One per restaurant per tab. Returns a stop function. */
export function startAutomation(db: Db): () => void {
  const key = db.restaurantId;
  if (running.has(key)) return () => undefined;
  const seen = new Set<string>();
  const onCheck = async (c: Check) => {
    if (c.status !== "paid" || !c.customerId || seen.has(c.id)) return;
    seen.add(c.id);
    const [order] = await db.list("orders", { where: { checkId: c.id } });
    if (order && order.mode !== "delivery") await queueFeedback(db, { ...order, customerId: order.customerId ?? c.customerId }, "visit");
  };
  const onOrder = async (o: Order) => {
    if (o.mode === "delivery" && o.deliveryStatus === "delivered" && !seen.has(o.id)) {
      seen.add(o.id);
      await queueFeedback(db, o, "delivery");
    }
  };
  const off = db.repo.subscribe(["checks", "orders"], db.restaurantId, (e) => {
    if (!e.row || e.optimistic || e.origin === "peer") return; // the tab that made the change handles it
    if (e.collection === "checks") void onCheck(e.row as Check).catch(() => undefined);
    if (e.collection === "orders") void onOrder(e.row as Order).catch(() => undefined);
  });
  const tick = async () => {
    try {
      await (await serviceFor(db)).flushDue();
    } catch {
      /* offline / not configured */
    }
  };
  const timer = setInterval(tick, 60_000);
  void tick();
  const stop = () => {
    off();
    clearInterval(timer);
    running.delete(key);
  };
  running.set(key, stop);
  return stop;
}

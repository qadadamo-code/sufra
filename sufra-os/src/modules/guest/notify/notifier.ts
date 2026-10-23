/**
 * Notifier — how order-status messages leave Sufra.
 *
 *   const n = getNotifier();
 *   await n.send({ restaurantId, to: "01005551201", lang: "ar", template: "order_received", vars, dedupeKey: `${orderId}:received` });
 *
 * Today: LogNotifier renders and keeps the last 100 messages (localStorage + BroadcastChannel), so a staff
 * "WhatsApp preview" drawer can show exactly what the customer would get. Wave 2: a WhatsAppCloudNotifier
 * that POSTs to our server function (which holds the WABA token) — same interface.
 */
import { uuid } from "@/lib/id";
import { loadJSON, saveJSON } from "@/lib/storage";
import type { Lang } from "@/i18n/i18n";
import { render, type TemplateId } from "./templates";

export interface OutgoingMessage {
  restaurantId: string;
  /** E.164 or local Egyptian mobile; normalised by the sender */
  to: string;
  lang: Lang;
  template: TemplateId;
  vars: Record<string, string | number>;
  /** at most one message per key (e.g. `${orderId}:out_for_delivery`) */
  dedupeKey?: string;
}

export interface SentMessage extends OutgoingMessage {
  id: string;
  text: string;
  at: string;
  status: "logged" | "queued" | "sent" | "delivered" | "read" | "failed";
  channel: "log" | "whatsapp" | "sms";
}

export interface Notifier {
  readonly channel: SentMessage["channel"];
  send(m: OutgoingMessage): Promise<SentMessage | null>;
}

/** +20 1xx xxx xxxx from 01xxxxxxxxx (Egypt); leaves anything else as typed. */
export function toE164(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  if (/^01[0125]\d{8}$/.test(d)) return `+2${d}`;
  if (/^201[0125]\d{8}$/.test(d)) return `+${d}`;
  return d;
}

const KEY = "sufra-guest.outbox";
const MAX = 100;

export class LogNotifier implements Notifier {
  readonly channel = "log" as const;
  private listeners = new Set<(all: SentMessage[]) => void>();
  private bc: BroadcastChannel | null = null;
  private mem: SentMessage[] = [];

  constructor(private storageKey = KEY) {
    this.mem = loadJSON<SentMessage[]>(storageKey, []);
    try {
      this.bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(storageKey) : null;
      if (this.bc) this.bc.onmessage = () => {
        this.mem = loadJSON<SentMessage[]>(this.storageKey, this.mem);
        this.emit();
      };
    } catch {
      this.bc = null;
    }
  }

  /** stable reference between changes (for useSyncExternalStore) */
  all(): SentMessage[] {
    return this.mem;
  }

  list(restaurantId?: string): SentMessage[] {
    return this.mem.filter((m) => !restaurantId || m.restaurantId === restaurantId);
  }

  subscribe(cb: (all: SentMessage[]) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  async send(m: OutgoingMessage): Promise<SentMessage | null> {
    if (m.dedupeKey && this.mem.some((x) => x.dedupeKey === m.dedupeKey && x.restaurantId === m.restaurantId)) return null;
    const msg: SentMessage = { ...m, to: toE164(m.to), id: uuid(), text: render(m.template, m.lang, m.vars), at: new Date().toISOString(), status: "logged", channel: "log" };
    this.mem = [msg, ...this.mem].slice(0, MAX);
    saveJSON(this.storageKey, this.mem);
    this.bc?.postMessage("change");
    this.emit();
    return msg;
  }

  clear() {
    this.mem = [];
    saveJSON(this.storageKey, this.mem);
    this.bc?.postMessage("change");
    this.emit();
  }

  close() {
    this.bc?.close();
    this.bc = null;
    this.listeners.clear();
  }

  private emit() {
    for (const l of this.listeners) l(this.mem);
  }
}

let instance: LogNotifier | null = null;
export function getNotifier(): LogNotifier {
  return (instance ??= new LogNotifier());
}

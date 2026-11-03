/**
 * Walkie-talkie channels and who is on them (pure).
 *
 *   الكل (all) · الصالة (floor) · المطبخ (kitchen) · الدليفري (delivery) · الإدارة (managers) · direct 1:1 (dm:<a>:<b>)
 *
 * "member" = may listen and talk. "monitored by default" = clips auto-play for that role without opening the channel
 * (the person can change it on /radio). Direct channels are members-only: exactly the two people.
 */
import type { Localized } from "@/data/types";
import type { Role } from "@/auth/roles";
import type { RadioChannelId, RadioClip } from "../types";

export type GroupChannel = Exclude<RadioChannelId, `dm:${string}`>;

export interface ChannelDef {
  id: GroupChannel;
  name: Localized;
  members: Role[];
  monitor: Role[];
  color: string;
}

const RESTAURANT_ROLES: Role[] = ["owner", "admin", "manager", "cashier", "waiter", "chef", "kitchen", "delivery", "accountant"];

export const CHANNELS: ChannelDef[] = [
  { id: "all", name: { ar: "الكل", en: "Everyone" }, members: RESTAURANT_ROLES, monitor: RESTAURANT_ROLES, color: "#1f6f6b" },
  { id: "floor", name: { ar: "الصالة", en: "Floor" }, members: ["owner", "admin", "manager", "cashier", "waiter", "chef"], monitor: ["manager", "waiter", "cashier"], color: "#b0893f" },
  { id: "kitchen", name: { ar: "المطبخ", en: "Kitchen" }, members: ["owner", "admin", "manager", "chef", "kitchen", "waiter", "cashier"], monitor: ["chef", "kitchen"], color: "#c0533a" },
  { id: "delivery", name: { ar: "الدليفري", en: "Delivery" }, members: ["owner", "admin", "manager", "cashier", "delivery"], monitor: ["delivery", "cashier"], color: "#3b6fb6" },
  { id: "managers", name: { ar: "الإدارة", en: "Managers" }, members: ["owner", "admin", "manager", "chef"], monitor: ["owner", "admin", "manager", "chef"], color: "#6b4fa3" },
];

export const channelDef = (id: string) => CHANNELS.find((c) => c.id === id) ?? null;

export const isDm = (id: string): id is `dm:${string}` => id.startsWith("dm:");

/** Stable 1:1 channel id for two members (order-independent). */
export function dmId(a: string, b: string): `dm:${string}` {
  const [x, y] = [a, b].sort();
  return `dm:${x}:${y}`;
}

export function dmPeer(id: string, me: string): string | null {
  if (!isDm(id)) return null;
  const [, a, b] = id.split(":");
  return a === me ? b : b === me ? a : null;
}

export function canJoin(role: Role | null, channel: string, me?: string | null): boolean {
  if (!role) return false;
  if (isDm(channel)) return !!me && dmPeer(channel, me) !== null && RESTAURANT_ROLES.includes(role);
  return !!channelDef(channel)?.members.includes(role);
}

export function channelsFor(role: Role | null): ChannelDef[] {
  return role ? CHANNELS.filter((c) => c.members.includes(role)) : [];
}

export function defaultMonitored(role: Role | null): GroupChannel[] {
  return role ? CHANNELS.filter((c) => c.monitor.includes(role)).map((c) => c.id) : [];
}

/** Should this clip auto-play / count as unread for me? Never my own clips. */
export function isForMe(clip: Pick<RadioClip, "channel" | "fromId">, me: string, role: Role | null, monitored: string[]): boolean {
  if (clip.fromId === me) return false;
  if (isDm(clip.channel)) return dmPeer(clip.channel, me) !== null;
  return canJoin(role, clip.channel) && monitored.includes(clip.channel);
}

/** Unread per channel since each channel's last-read time. */
export function unreadCounts(clips: Pick<RadioClip, "channel" | "fromId" | "at">[], me: string, role: Role | null, lastRead: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of clips) {
    if (c.fromId === me) continue;
    if (isDm(c.channel) ? dmPeer(c.channel, me) === null : !canJoin(role, c.channel)) continue;
    const lr = lastRead[c.channel];
    if (lr && c.at <= lr) continue;
    out[c.channel] = (out[c.channel] ?? 0) + 1;
  }
  return out;
}

/** Quick canned messages (sent as text + read aloud with speech synthesis on the receiver if available). */
export const CANNED: { id: string; text: Localized; channel: GroupChannel; needsTable?: boolean }[] = [
  { id: "table_needs", text: { ar: "طاولة {t} محتاجة جرسون", en: "Table {t} needs a waiter" }, channel: "floor", needsTable: true },
  { id: "order_ready", text: { ar: "طلب طاولة {t} جاهز — حد ييجي ياخده", en: "Table {t} order is ready — pick up please" }, channel: "floor", needsTable: true },
  { id: "need_manager", text: { ar: "محتاج المدير في الصالة", en: "Manager needed on the floor" }, channel: "managers" },
  { id: "rider_ready", text: { ar: "أوردر الدليفري جاهز — الطيار ييجي", en: "Delivery order ready — rider to the pass" }, channel: "delivery" },
  { id: "rider_arrived", text: { ar: "وصلت للعميل", en: "Arrived at the customer" }, channel: "delivery" },
  { id: "rush", text: { ar: "زحمة — الكل يساعد في الصالة", en: "Rush — everyone help on the floor" }, channel: "all" },
  { id: "86", text: { ar: "صنف خلص — راجعوا المنيو", en: "An item is 86'd — check the menu" }, channel: "kitchen" },
  { id: "clean", text: { ar: "طاولة {t} محتاجة تنضيف", en: "Table {t} needs clearing" }, channel: "floor", needsTable: true },
];

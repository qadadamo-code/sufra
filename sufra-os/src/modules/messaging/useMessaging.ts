/** Hooks shared by the messaging screens (and the nav badge, which also starts the staff-app automation). */
import { useCallback, useEffect, useMemo } from "react";
import { useBranch, useSession } from "@/auth/session";
import { useDb, useLive, useRepo } from "@/data/hooks";
import type { Conversation, Message, Settings } from "@/data/types";
import { notifierFor, type Notifier } from "@/lib/notify/notifier";
import { envFor, startAutomation } from "@/lib/notify/register";
import { MessagingService } from "@/lib/notify/service";
import { messagingSettingsOf, type MessagingSettings } from "@/lib/notify/settings";

/** Unread conversations + messages waiting for a click-to-chat tap. Starts feedback/scheduled-send automation. */
export function useInboxBadge(): number | null {
  const db = useDb();
  const allowed = useSession().can("messages.use");
  const conv = useLive("conversations", { where: { status: "open" } }).data;
  const taps = useLive("messages", { where: { status: "pending_tap" } }).data.length;
  useEffect(() => (allowed ? startAutomation(db) : undefined), [db, allowed]);
  const unread = conv.filter((c) => c.unread > 0).length;
  return unread + taps || null;
}

export function useMessagingSettings(): { row: Settings | null; ms: MessagingSettings } {
  const row = useLive("settings").data[0] ?? null;
  const ms = useMemo(() => messagingSettingsOf(row), [row]);
  return { row, ms };
}

/**
 * A MessagingService for the current restaurant + settings. `svc()` uses the configured channel;
 * `svc(open)` — from a click handler — lets click-to-chat open WhatsApp right away.
 */
export function useMessagingService() {
  const db = useDb();
  const repo = useRepo();
  const session = useSession();
  const branch = useBranch();
  const { ms } = useMessagingSettings();
  const restaurant = session.restaurant;
  const svc = useCallback(
    (open?: (url: string) => void, notifier?: Notifier) =>
      new MessagingService(
        db,
        ms,
        restaurant ?? { id: db.restaurantId, name: { ar: "", en: "" }, slug: "", timezone: "Africa/Cairo", country: ms.country },
        branch ?? null,
        notifier ?? notifierFor(ms, envFor(repo, { open })),
      ),
    [db, ms, restaurant, branch, repo],
  );
  return { svc, ms, db };
}

/** opens a URL in a new tab from a click handler (popup-safe) */
export const openTab = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

export const sortConversations = (a: Conversation, b: Conversation) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt);
export const byTime = (a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt);

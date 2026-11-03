/**
 * Per-restaurant messaging settings (settings.messaging jsonb — 0007_messaging.sql). Optional on the row:
 * `messagingSettingsOf(settings)` fills defaults, so older rows keep working.
 * No secrets here: the WhatsApp token lives server side (Vercel env / Supabase Vault).
 */
import type { Settings } from "@/data/types";
import type { NotifyStage } from "@/modules/guest/notify/templates";
import { DEFAULT_RATES, type Country, type RateCard } from "./core";

export type MessagingMode = "off" | "click_to_chat" | "cloud" | "bsp";
export type BspProvider = "unifonic" | "infobip" | "360dialog" | "twilio";
export type TemplateReviewStatus = "draft" | "submitted" | "approved" | "rejected";

export interface MessagingSettings {
  mode: MessagingMode;
  bsp: BspProvider | null;
  /** the WhatsApp Business number customers see (display only) */
  senderNumber: string;
  displayName: string;
  country: Country;
  /** order stages that send automatically */
  autoStages: NotifyStage[];
  businessHours: { enabled: boolean; useBranchHours: boolean; open: string; close: string; reply: { ar: string; en: string } };
  feedback: { enabled: boolean; afterDelivery: boolean; afterVisit: boolean; delayMin: number };
  /** no marketing / scheduled messages in this window (local time) */
  quietHours: { enabled: boolean; start: string; end: string };
  /** marketing messages per customer per 7 days */
  marketingCapPerWeek: number;
  smsFallback: boolean;
  rates: RateCard;
  /** Meta review state per template id */
  templates: Record<string, { status: TemplateReviewStatus; updatedAt: string; reason?: string }>;
  /** the "test send" number (staff's own) */
  testNumber: string;
}

export const DEFAULT_MESSAGING: MessagingSettings = {
  mode: "click_to_chat",
  bsp: null,
  senderNumber: "",
  displayName: "",
  country: "EG",
  autoStages: ["received", "accepted", "ready_pickup", "out_for_delivery", "delivered", "cancelled", "delayed"],
  businessHours: {
    enabled: true,
    useBranchHours: true,
    open: "12:00",
    close: "01:00",
    reply: {
      ar: "أهلاً بيك 👋 إحنا قافلين دلوقتي وهنرد عليك أول ما نفتح. تقدر تطلب أونلاين في أي وقت.",
      en: "Hi 👋 we're closed right now and will reply as soon as we open. You can order online any time.",
    },
  },
  feedback: { enabled: true, afterDelivery: true, afterVisit: true, delayMin: 45 },
  quietHours: { enabled: true, start: "23:00", end: "10:00" },
  marketingCapPerWeek: 2,
  smsFallback: false,
  rates: DEFAULT_RATES,
  templates: {},
  testNumber: "",
};

export function messagingSettingsOf(s: Pick<Settings, "messaging"> | null | undefined): MessagingSettings {
  const m = s?.messaging;
  if (!m) return DEFAULT_MESSAGING;
  return {
    ...DEFAULT_MESSAGING,
    ...m,
    businessHours: { ...DEFAULT_MESSAGING.businessHours, ...m.businessHours, reply: { ...DEFAULT_MESSAGING.businessHours.reply, ...m.businessHours?.reply } },
    feedback: { ...DEFAULT_MESSAGING.feedback, ...m.feedback },
    quietHours: { ...DEFAULT_MESSAGING.quietHours, ...m.quietHours },
    rates: { EG: { ...DEFAULT_RATES.EG, ...m.rates?.EG }, SA: { ...DEFAULT_RATES.SA, ...m.rates?.SA } },
    templates: { ...m.templates },
  };
}

/** Device-local API key for deployments without Supabase (SUFRA_API_KEY on the server). Never synced. */
export const API_KEY_STORAGE = "sufra-os.messaging.apiKey";

import { lazy } from "react";
import { MessageCircle } from "lucide-react";
import { registerOrderNotifier } from "@/lib/notify/register";
import { defineModule } from "../types";
import { useInboxBadge } from "./useMessaging";

/**
 * WhatsApp & customer messaging (Wave 2, feature catalogue §6).
 *
 *   /messages              shared inbox (conversations, 24h window, assign, quick replies, menu item/offer, order status)
 *   /messages/templates    template catalogue: AR/EN preview, category, Meta review status, copy the submission JSON
 *   /messages/consent      opt-in / opt-out register (wording, source, time)
 *   /messages/log          every message with its delivery status + cost estimate
 *   /settings/messaging    channel (off / click-to-chat / Cloud API / BSP), auto stages, hours, feedback, test send, Meta guide
 *
 * Sending logic lives in src/lib/notify (shared with api/whatsapp-*.ts). At start-up we register our sender with
 * the delivery module's notifyOrderStage(), so every order stage goes through consent, dedupe and the log.
 */
registerOrderNotifier();

export default defineModule({
  id: "messaging",
  status: "ready",
  icon: MessageCircle,
  title: { ar: "واتساب والرسايل", en: "WhatsApp & messages" },
  description: { ar: "صندوق رسايل مشترك، قوالب واتساب، موافقات الزباين وسجل الرسايل", en: "Shared inbox, WhatsApp templates, customer consent and the message log" },
  permission: "messages.use",
  shortcut: "g i",
  nav: { path: "/messages", group: "service", order: 65, useBadge: useInboxBadge },
  keywords: ["whatsapp", "واتساب", "inbox", "رسايل", "رسائل", "sms", "templates", "قوالب", "opt-in", "STOP"],
  routes: [
    { path: "/messages/*", element: lazy(() => import("./MessagesPage")) },
    { path: "/settings/messaging", element: lazy(() => import("./SettingsPage")), permission: "settings.view", title: { ar: "الرسايل", en: "Messaging" } },
  ],
  features: [
    { ar: "رسايل حالة الطلب أوتوماتيك على واتساب", en: "Automatic order-status messages on WhatsApp" },
    { ar: "إرسال بالضغط (wa.me) من غير حساب Meta", en: "Click-to-chat (wa.me) with no Meta account" },
  ],
  data: ["conversations", "messages", "messagingConsents"],
});

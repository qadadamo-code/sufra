/**
 * Customer messaging (WhatsApp first). See README in src/modules/messaging and docs/WHATSAPP-SETUP.md.
 *
 *   core.ts       pure helpers shared with the Vercel functions (phones, wa.me, 24h window, payloads, webhook parsing, cost)
 *   templates.ts  template catalogue (AR/EN, Utility/Marketing/Authentication) + Meta submission JSON
 *   notifier.ts   Notifier interface + adapters (Cloud API, click-to-chat, BSP stubs, SMS stub, log) + notifierFor()
 *   service.ts    MessagingService: conversations, consent, policy, dispatch, scheduled sends, webhook mirror
 *   register.ts   registerOrderNotifier() for delivery's notifyOrderStage, feedback queue, staff-app automation
 */
export * from "./core";
export * from "./templates";
export * from "./settings";
export * from "./notifier";
export * from "./service";
export { registerOrderNotifier, startAutomation, queueFeedback, serviceFor, apiAuth, envFor } from "./register";

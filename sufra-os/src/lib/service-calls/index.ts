/**
 * Service calls (guest → waiter requests, kitchen → waiter pickup pings).
 *
 *   import { callLevel, sortInbox, callStats, createServiceCall, ackCall, doneCall, CallIcon, useSla, useNow } from "@/lib/service-calls";
 *
 * core.ts   pure rules: types/priority, SLA thresholds, escalation ladder, routing, de-duplication, KPIs
 * ops.ts    writes through the Db (create / ack / done / cancel / escalate / pingWaiter)
 * hooks.ts  useNow, useSla, useTodayCalls, useEscalationStamper, useArrivals
 * icons.tsx icon + tone per type/level
 * sound.ts  Web Audio cues + vibration, per-device on/off
 * alerts.tsx useCallAlerts(): toasts + sounds for new/escalated calls and ready food (mounted by the shell bell)
 */
export * from "./core";
export * from "./ops";
export * from "./hooks";
export * from "./icons";
export * from "./sound";
export * from "./alerts";
export * from "./SlaEditor";

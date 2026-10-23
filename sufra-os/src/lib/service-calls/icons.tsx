/** Icon + tone per call type/level (React side of the service-call core). */
import type { LucideIcon } from "lucide-react";
import { BellRing, ChefHat, Coffee, GlassWater, HandHelping, Layers, MessageSquare, Receipt, Sparkles, TriangleAlert, Utensils, Leaf } from "lucide-react";
import type { ServiceCallType } from "@/data/types";
import type { CallLevel } from "./core";

export const CALL_ICON: Record<ServiceCallType, LucideIcon> = {
  waiter: BellRing,
  water: GlassWater,
  napkins: Layers,
  coffee: Coffee,
  tea: Leaf,
  item: Utensils,
  clean_table: Sparkles,
  bill: Receipt,
  complaint: TriangleAlert,
  help: HandHelping,
  other: MessageSquare,
  pickup: ChefHat,
};

export type LevelTone = "neutral" | "primary" | "brass" | "ok" | "warn" | "danger" | "info";
export const LEVEL_TONE: Record<CallLevel, LevelTone> = { fresh: "info", warn: "warn", escalated: "danger", critical: "danger", ack: "primary", closed: "neutral" };

export function CallIcon({ type, className }: { type: ServiceCallType; className?: string }) {
  const I = CALL_ICON[type] ?? MessageSquare;
  return <I className={className} aria-hidden />;
}

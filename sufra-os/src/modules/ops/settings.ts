/** Ops settings row (one per restaurant, id = restaurant id) with defaults + save. */
import { useMemo } from "react";
import { useDb, useLive, type Db } from "@/data/hooks";
import type { OpsSettings } from "./types";
import { DEFAULT_SLA } from "./support/tickets";
import { DEFAULT_RULES } from "./alerts/alerts";

export type OpsConfig = Omit<OpsSettings, "id" | "restaurantId" | "createdAt" | "updatedAt">;

export const DEFAULT_OPS: OpsConfig = {
  hotlinePhone: "",
  whatsappPhone: "",
  sufraSupportPhone: "",
  sufraSupportWhatsapp: "",
  gatewayUrl: "",
  playbackTemplates: {},
  nvrHost: "",
  clipPadSec: 30,
  zoneCapacity: {},
  sla: DEFAULT_SLA,
  alertRules: DEFAULT_RULES,
  radio: { maxClipSec: 30, minClipMs: 400, autoplay: true },
};

export function withDefaults(row: Partial<OpsSettings> | null | undefined): OpsConfig {
  const r = row ?? {};
  return {
    ...DEFAULT_OPS,
    ...r,
    sla: { ...DEFAULT_SLA, ...(r.sla ?? {}) },
    radio: { ...DEFAULT_OPS.radio, ...(r.radio ?? {}) },
    alertRules: DEFAULT_RULES.map((d) => r.alertRules?.find((x) => x.kind === d.kind) ?? d),
    playbackTemplates: { ...(r.playbackTemplates ?? {}) },
    zoneCapacity: { ...(r.zoneCapacity ?? {}) },
  };
}

export function useOpsSettings(): { cfg: OpsConfig; row: OpsSettings | null; loading: boolean } {
  const live = useLive("opsSettings");
  const row = live.data[0] ?? null;
  const cfg = useMemo(() => withDefaults(row), [row]);
  return { cfg, row, loading: live.loading };
}

export async function saveOpsSettings(db: Db, patch: Partial<OpsConfig>) {
  const cur = await db.get("opsSettings", db.restaurantId);
  if (cur) return db.update("opsSettings", cur.id, patch);
  return db.insert("opsSettings", { id: db.restaurantId, ...DEFAULT_OPS, ...patch });
}

export function useSaveOps() {
  const db = useDb();
  return (patch: Partial<OpsConfig>) => saveOpsSettings(db, patch);
}

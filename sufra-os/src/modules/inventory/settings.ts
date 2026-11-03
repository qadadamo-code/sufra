import type { InventorySettings, Settings } from "@/data/types";
import { major } from "@/lib/money";

export const DEFAULT_INVENTORY: InventorySettings = {
  deductAt: "send",
  varianceAlertBp: 300,
  priceAlertBp: 500,
  expiryWarnDays: 2,
  allowNegative: true,
  coverDays: 3,
  approvalVarianceValue: major(500),
};

export const inventorySettings = (s: Pick<Settings, "inventory"> | null | undefined): InventorySettings => ({ ...DEFAULT_INVENTORY, ...(s?.inventory ?? {}) });

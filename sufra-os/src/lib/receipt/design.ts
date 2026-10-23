import type { InvoiceDesign, InvoiceTemplate } from "@/data/types";

export const DEFAULT_DESIGN: InvoiceDesign = {
  paper: "80",
  logoDataUrl: null,
  accent: "#0d5a53",
  fontSize: 12,
  fields: {
    branch: true,
    address: true,
    phone: true,
    taxId: true,
    activityCode: true,
    cashier: true,
    table: true,
    guests: true,
    orderType: true,
    customer: true,
    modifiers: true,
    itemNotes: true,
    serviceVatLines: true,
    payments: true,
    etaUuid: true,
  },
};

/** The invoice template with every designer field filled (older settings rows have no `design`). */
export function resolveDesign(t: Pick<InvoiceTemplate, "design" | "paperWidth"> | null | undefined): InvoiceDesign {
  const d = t?.design;
  return {
    ...DEFAULT_DESIGN,
    ...(t?.paperWidth ? { paper: String(t.paperWidth) as "58" | "80" } : {}),
    ...(d ?? {}),
    fields: { ...DEFAULT_DESIGN.fields, ...(d?.fields ?? {}) },
  };
}

export const PAPER_MM: Record<InvoiceDesign["paper"], number> = { "58": 58, "80": 80, a4: 210 };

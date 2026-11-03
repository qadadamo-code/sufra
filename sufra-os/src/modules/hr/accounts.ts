/** Account names for journal previews (the accounting module owns the chart). */
import { DEFAULT_CHART } from "@/modules/accounting/chart";

const byCode = new Map(DEFAULT_CHART.map((a) => [a.code, a]));
export const accountName = (code: string, lang: "ar" | "en") => byCode.get(code)?.[lang] ?? code;

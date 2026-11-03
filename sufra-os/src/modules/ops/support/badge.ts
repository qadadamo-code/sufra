import { useLive } from "@/data/hooks";

/** New + unassigned-open guest complaints. */
export function useTicketsBadge(): number | null {
  const n = useLive("supportTickets", { where: { kind: "guest", status: ["new"] } }).data.length;
  return n || null;
}

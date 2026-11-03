/** Shared HR data for the staff screens and /me: people, files, rules, time zone, today's business day. */
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import type { Membership, StaffCompensation, StaffProfile } from "@/data/types";
import { hrSettings } from "./lib/settings";
import { businessDate } from "./lib/tz";
import { tzOf } from "./ops";

/** re-render every `ms` (clocks, "who's in now") */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useHr() {
  const session = useSession();
  const canPay = session.can("staff.payroll");
  const canManage = session.can("staff.manage");
  const settings = useLive("settings").data[0] ?? null;
  const rules = useMemo(() => hrSettings(settings), [settings]);
  const tz = tzOf(settings);
  const allMembers = useLive("memberships", { orderBy: [{ field: "name" }] }).data;
  const members = useMemo(() => allMembers.filter((m) => m.role !== "platform_admin"), [allMembers]);
  const profiles = useLive("staffProfiles").data;
  const comps = useLive("staffCompensation", undefined, { enabled: canPay }).data;
  const now = useNow(60_000);
  const today = businessDate(now, tz);
  const profileOf = useMemo(() => {
    const m = new Map<string, StaffProfile>(profiles.map((p) => [p.membershipId, p]));
    return (id: string | null | undefined) => (id ? m.get(id) : undefined);
  }, [profiles]);
  const compOf = useMemo(() => {
    const m = new Map<string, StaffCompensation>(comps.map((c) => [c.membershipId, c]));
    return (id: string | null | undefined) => (id ? m.get(id) : undefined);
  }, [comps]);
  const memberOf = useMemo(() => {
    const m = new Map<string, Membership>(members.map((x) => [x.id, x]));
    return (id: string | null | undefined) => (id ? m.get(id) : undefined);
  }, [members]);
  return { session, canPay, canManage, settings, rules, tz, members, active: members.filter((m) => m.active), profiles, comps, today, now, profileOf, compOf, memberOf, currency: session.restaurant?.currency ?? "EGP" };
}

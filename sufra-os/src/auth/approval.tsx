/**
 * Manager-PIN approvals for sensitive actions.
 *
 *   const approve = useApproval();
 *   const approver = await approve({ kind: "discount", pct: 15 }, L("خصم ١٥٪", "15% discount"));
 *   if (!approver) return;            // cancelled / denied
 *   // approver.id → store as discountApprovedBy; an audit_log row is already written
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { useRepo, useScope, makeDb } from "@/data/hooks";
import type { Membership } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { Avatar, Dialog, PinPad, useToast } from "@/ui";
import { cn } from "@/lib/cn";
import { authorize, approversFor, type Action, type Policy } from "./permissions";
import { ROLE_LABEL } from "./roles";
import { useSession } from "./session";

type Request = { action: Action; label: string; resolve: (m: Membership | null) => void };
const Ctx = createContext<((a: Action, label: string, policy?: Policy) => Promise<Membership | null>) | null>(null);

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const repo = useRepo();
  const scope = useScope();
  const session = useSession();
  const { t, lang } = useT();
  const { toast } = useToast();
  const [req, setReq] = useState<Request | null>(null);
  const [roster, setRoster] = useState<Membership[]>([]);
  const [picked, setPicked] = useState<Membership | null>(null);
  const reqRef = useRef<Request | null>(null);

  const request = useCallback(
    async (action: Action, label: string, policy?: Policy) => {
      const staff = session.staff;
      if (!staff || !scope.restaurantId) return null;
      const d = authorize(staff.role, action, policy);
      if (d.ok) return staff;
      if (d.needs === "denied") {
        toast({ title: t("approval.denied"), tone: "error" });
        return null;
      }
      const all = await repo.auth.pinRoster(scope.restaurantId);
      const allowed = approversFor(action);
      const list = all.filter((m) => allowed.includes(m.role) && m.id !== staff.id);
      setRoster(list);
      setPicked(list.length === 1 ? list[0] : null);
      return new Promise<Membership | null>((resolve) => {
        const r = { action, label, resolve };
        reqRef.current = r;
        setReq(r);
      });
    },
    [repo, scope.restaurantId, session.staff, toast, t],
  );

  const finish = (m: Membership | null) => {
    reqRef.current?.resolve(m);
    reqRef.current = null;
    setReq(null);
    setPicked(null);
  };

  const check = async (pin: string) => {
    if (!picked || !scope.restaurantId || !req) return false;
    const m = await repo.auth.verifyPin(scope.restaurantId, picked.id, pin);
    if (!m || !approversFor(req.action).includes(m.role)) return false;
    const db = makeDb(repo, scope.restaurantId, scope.branchId, scope.actorId);
    await db.audit(`approval.${req.action.kind}`, "approval", null, { action: req.action, label: req.label }, m.id);
    setTimeout(() => finish(m), 350);
    return true;
  };

  return (
    <Ctx.Provider value={request}>
      {children}
      <Dialog open={!!req} onClose={() => finish(null)} size="sm" title={t("approval.title")} description={req ? t("approval.body", { action: req.label }) : undefined}>
        <div className="grid gap-5 pt-2">
          {roster.length > 1 ? (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-muted">{t("approval.pick")}</p>
              <div className="flex flex-wrap gap-2">
                {roster.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPicked(m)}
                    className={cn("flex min-h-11 items-center gap-2 rounded-full border py-1 ps-1 pe-3.5 text-[14px] font-semibold transition-colors", picked?.id === m.id ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-surface-2")}
                  >
                    <Avatar name={m.name} color={m.color} size="sm" />
                    {m.name}
                    <span className="text-[12px] font-medium text-muted">{ROLE_LABEL[m.role][lang]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {picked ? (
            <div className="grid gap-3">
              <p className="flex items-center justify-center gap-2 text-[14px] font-semibold">
                <ShieldCheck className="size-4 text-primary" aria-hidden />
                {picked.name}
              </p>
              <PinPad key={picked.id} onComplete={check} size="md" />
            </div>
          ) : null}
        </div>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useApproval() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApproval outside ApprovalProvider");
  return c;
}

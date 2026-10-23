/**
 * Who is using the app, for which restaurant and branch.
 *
 * Two ways in:
 *  - Email + password (owners, managers, accountants on their own devices). Their membership is the actor.
 *  - PIN on a shared device (POS / kitchen / waiter tablets). The device is paired to a restaurant
 *    (automatically in local demo mode; by a manager's email sign-in in cloud mode) and any staff member
 *    with a PIN can take it over. "Lock" returns to the staff picker without signing the device out.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRepo, ScopeProvider } from "@/data/hooks";
import type { AuthUser } from "@/data/repo";
import type { Branch, Membership, Restaurant } from "@/data/types";
import { loadJSON, loadRaw, saveJSON, saveRaw } from "@/lib/storage";
import { DEMO_RESTAURANT_ID } from "@/data/seed";
import { can, type Permission } from "./permissions";
import type { Role } from "./roles";

const PIN_KEY = "sufra-os.pinSession";
const DEVICE_KEY = "sufra-os.device";
const RESTAURANT_KEY = "sufra-os.restaurant";
const branchKey = (rid: string) => `sufra-os.branch.${rid}`;

export interface SessionState {
  status: "booting" | "signed-out" | "locked" | "ready";
  user: AuthUser | null;
  /** restaurants the email user belongs to */
  memberships: { membership: Membership; restaurant: Restaurant }[];
  restaurant: Restaurant | null;
  branches: Branch[];
  branchId: string | null;
  /** the staff member acting right now */
  staff: Membership | null;
  method: "password" | "pin" | null;
  /** restaurant this device is paired to for PIN sign-in */
  deviceRestaurantId: string | null;
}

interface SessionApi extends SessionState {
  role: Role | null;
  can: (p: Permission) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  pinSignIn: (membershipId: string, pin: string) => Promise<Membership | null>;
  lock: () => void;
  signOut: () => Promise<void>;
  switchRestaurant: (id: string) => Promise<void>;
  switchBranch: (id: string) => void;
}

const Ctx = createContext<SessionApi | null>(null);

const INITIAL: SessionState = { status: "booting", user: null, memberships: [], restaurant: null, branches: [], branchId: null, staff: null, method: null, deviceRestaurantId: null };

export function SessionProvider({ children }: { children: ReactNode }) {
  const repo = useRepo();
  const [s, setS] = useState<SessionState>(INITIAL);

  const loadTenant = useCallback(
    async (rid: string, staff: Membership | null) => {
      const [restaurant] = await repo.list("restaurants", { where: { id: rid } });
      if (!restaurant) return null;
      let branches = await repo.list("branches", { where: { restaurantId: rid }, orderBy: [{ field: "isDefault", dir: "desc" }] });
      if (staff?.branchIds.length) branches = branches.filter((b) => staff.branchIds.includes(b.id));
      const saved = loadRaw(branchKey(rid));
      const branchId = branches.find((b) => b.id === saved)?.id ?? branches[0]?.id ?? null;
      return { restaurant, branches, branchId };
    },
    [repo],
  );

  const boot = useCallback(async () => {
    const user = await repo.auth.current().catch(() => null);
    const memberships = user ? await repo.auth.myMemberships().catch(() => []) : [];
    let device = loadRaw(DEVICE_KEY);
    if (!device && repo.kind === "local") device = DEMO_RESTAURANT_ID;
    if (!device && memberships[0]) device = memberships[0].restaurant.id;

    // 1) a PIN session on this device
    const pin = loadJSON<{ membershipId: string; restaurantId: string } | null>(PIN_KEY, null);
    if (pin && pin.restaurantId === device) {
      const [m] = await repo.list("memberships", { where: { id: pin.membershipId, active: true } }).catch(() => []);
      if (m) {
        const t = await loadTenant(m.restaurantId, m);
        if (t) return setS({ status: "ready", user, memberships, ...t, staff: m, method: "pin", deviceRestaurantId: device });
      }
      saveJSON(PIN_KEY, null);
    }
    // 2) an email session
    if (user && memberships.length) {
      const savedR = loadRaw(RESTAURANT_KEY);
      const pick = memberships.find((x) => x.restaurant.id === savedR) ?? memberships[0];
      const t = await loadTenant(pick.restaurant.id, pick.membership);
      if (t) return setS({ status: "ready", user, memberships, ...t, staff: pick.membership, method: "password", deviceRestaurantId: device });
    }
    // 3) nobody: a paired device shows the PIN screen
    setS({ ...INITIAL, status: device ? "locked" : "signed-out", user, memberships, deviceRestaurantId: device });
  }, [repo, loadTenant]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await repo.auth.signInWithPassword(email, password);
      const memberships = await repo.auth.myMemberships();
      if (!memberships.length) {
        await repo.auth.signOut();
        throw Object.assign(new Error("no_membership"), { code: "no_membership" });
      }
      saveJSON(PIN_KEY, null);
      // the restaurant this person signs in to becomes the device's restaurant for PIN sign-in
      const savedR = loadRaw(RESTAURANT_KEY);
      const pick = memberships.find((x) => x.restaurant.id === savedR) ?? memberships[0];
      saveRaw(DEVICE_KEY, pick.restaurant.id);
      await boot();
    },
    [repo, boot],
  );

  const pinSignIn = useCallback(
    async (membershipId: string, pin: string) => {
      const rid = s.deviceRestaurantId;
      if (!rid) return null;
      const m = await repo.auth.verifyPin(rid, membershipId, pin);
      if (!m) return null;
      saveJSON(PIN_KEY, { membershipId: m.id, restaurantId: rid });
      const t = await loadTenant(rid, m);
      if (!t) return null;
      setS((p) => ({ ...p, status: "ready", ...t, staff: m, method: "pin" }));
      return m;
    },
    [repo, s.deviceRestaurantId, loadTenant],
  );

  const lock = useCallback(() => {
    saveJSON(PIN_KEY, null);
    setS((p) => ({ ...p, status: p.deviceRestaurantId ? "locked" : "signed-out", staff: null, method: null }));
  }, []);

  const signOut = useCallback(async () => {
    saveJSON(PIN_KEY, null);
    await repo.auth.signOut();
    await boot();
  }, [repo, boot]);

  const switchRestaurant = useCallback(
    async (id: string) => {
      const pick = s.memberships.find((x) => x.restaurant.id === id);
      if (!pick) return;
      saveRaw(RESTAURANT_KEY, id);
      saveRaw(DEVICE_KEY, id);
      const t = await loadTenant(id, pick.membership);
      if (t) setS((p) => ({ ...p, ...t, staff: pick.membership, method: "password", deviceRestaurantId: id }));
    },
    [s.memberships, loadTenant],
  );

  const switchBranch = useCallback(
    (id: string) => {
      if (!s.restaurant) return;
      saveRaw(branchKey(s.restaurant.id), id);
      setS((p) => ({ ...p, branchId: id }));
    },
    [s.restaurant],
  );

  // keep the acting staff row fresh (role or name edits by a manager on another device)
  useEffect(() => {
    if (!s.staff || !s.restaurant) return;
    return repo.subscribe(["memberships"], s.restaurant.id, (e) => {
      if (e.id !== s.staff?.id || !e.row) return;
      const m = e.row as Membership;
      if (!m.active) lock();
      else setS((p) => ({ ...p, staff: m }));
    });
  }, [repo, s.staff?.id, s.restaurant, lock]); // eslint-disable-line react-hooks/exhaustive-deps

  const role = s.staff?.role ?? null;
  const api = useMemo<SessionApi>(
    () => ({ ...s, role, can: (p) => can(role, p), signIn, pinSignIn, lock, signOut, switchRestaurant, switchBranch }),
    [s, role, signIn, pinSignIn, lock, signOut, switchRestaurant, switchBranch],
  );

  return (
    <Ctx.Provider value={api}>
      <ScopeProvider restaurantId={s.restaurant?.id ?? s.deviceRestaurantId} branchId={s.branchId} actorId={s.staff?.id ?? null}>
        {children}
      </ScopeProvider>
    </Ctx.Provider>
  );
}

export function useSession(): SessionApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}

/** Current branch row. */
export function useBranch() {
  const { branches, branchId } = useSession();
  return branches.find((b) => b.id === branchId) ?? null;
}

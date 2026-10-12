import { useMemo, useSyncExternalStore } from "react";
import { measureFromArea, nearestArea, useLocation } from "./location";
import { areaById, byId, restaurants, type Mood } from "./data";
import type { LatLng } from "./geo";
import type { PriceBreakdown, PriceMode } from "./pricing";
import { load, save } from "./storage";

/* ───────────────────────── types ───────────────────────── */
export interface Profile {
  name: string;
  phone: string;
  hasPassword: boolean;
  homeArea: string;
  home: LatLng;
  diet: string[];
  moods: Mood[];
  inviteCode: string;
  joined: string; // ISO date
  demo?: boolean;
}
export interface Booking {
  id: string;
  rid: string;
  date: string; // YYYY-MM-DD
  time: number; // minutes since midnight
  party: number;
  seating: string;
  notes: string;
  tags: string[];
  status: "confirmed" | "cancelled";
  code: string;
  createdAt: number;
}
export interface OrderLine {
  itemId: string;
  qty: number;
  unit: number; // piastres
}
export interface Order {
  id: string;
  rid: string;
  lines: OrderLine[];
  mode: PriceMode;
  breakdown: PriceBreakdown;
  code?: string;
  address?: string;
  payment: "cash" | "card";
  createdAt: number;
  /** seconds per tracking step (demo speed) */
  stepSec: number;
  seeded?: boolean;
}
export interface WalletEntry {
  offerId: string;
  rid: string;
  code: string;
  savedAt: number;
}
export interface PlanMessage {
  name: string;
  text: string;
  time: string;
}
export interface Plan {
  id: string;
  title: string;
  when: string;
  candidates: string[]; // rids
  votes: Record<string, string>; // member → rid
  members: string[];
  messages: PlanMessage[];
  createdAt: number;
}
export interface Account {
  profile: Profile;
  favourites: string[];
  bookings: Booking[];
  orders: Order[];
  wallet: WalletEntry[];
  visits: Record<string, number>; // YYYY-MM-DD → count
  points: number;
  plans: Plan[];
}
export interface CartState {
  rid: string;
  lines: { itemId: string; qty: number }[];
}
export interface State {
  v: number;
  current: string | null; // phone of the signed-in account
  accounts: Record<string, Account>;
  cart: CartState | null;
  guestArea: string;
  recent: string[];
}

/* ───────────────────────── seed (clearly fake demo) ───────────────────────── */
export const DEMO_PHONE = "01012345678";
export const DEMO_OTP = "204815";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const todayYmd = () => ymd(new Date());
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const ymdOf = ymd;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function seedAccount(): Account {
  const now = new Date();
  const rand = rng(42);
  const visits: Record<string, number> = {};
  for (let i = 0; i < 365; i++) {
    const d = addDays(now, -i);
    const wd = d.getDay();
    const p = wd === 4 || wd === 5 ? 0.55 : 0.22; // Thursday/Friday nights out
    if (i < 6 || rand() < p) visits[ymd(d)] = 1 + (rand() < 0.25 ? 1 : 0) + (rand() < 0.06 ? 1 : 0);
  }
  const favs = [restaurants[0].id, restaurants[7].id, restaurants[15].id, restaurants[31].id, restaurants[44].id];
  const order = (rIdx: number, daysAgo: number): Order => {
    const r = restaurants[rIdx];
    const items = r.menu.flatMap((s) => s.items).slice(0, 3);
    const lines = items.map((it, i) => ({ itemId: it.id, qty: i === 0 ? 2 : 1, unit: it.price * 100 }));
    const subtotal = lines.reduce((a, l) => a + l.unit * l.qty, 0);
    const vat = Math.floor((subtotal * 1400 + 5000) / 10000);
    const fee = (r.delivery?.fee ?? 20) * 100;
    return {
      id: `o-seed-${rIdx}`,
      rid: r.id,
      lines,
      mode: "delivery",
      breakdown: { subtotal, discount: 0, service: 0, vat, deliveryFee: fee, total: subtotal + vat + fee },
      payment: "cash",
      address: "14 شارع مصدق، الدقي (عنوان تجريبي)",
      createdAt: addDays(now, -daysAgo).getTime(),
      stepSec: 8,
      seeded: true,
    };
  };
  const upcoming = addDays(now, 3);
  const bookings: Booking[] = [
    {
      id: "b-seed-1",
      rid: restaurants[7].id,
      date: ymd(upcoming),
      time: 20 * 60 + 30,
      party: 4,
      seating: "outdoor",
      notes: "ترابيزة جنب الشباك لو ينفع",
      tags: ["birthday"],
      status: "confirmed",
      code: "SF-48K2",
      createdAt: addDays(now, -2).getTime(),
    },
    {
      id: "b-seed-2",
      rid: restaurants[15].id,
      date: ymd(addDays(now, -12)),
      time: 21 * 60,
      party: 2,
      seating: "any",
      notes: "",
      tags: [],
      status: "confirmed",
      code: "SF-19QA",
      createdAt: addDays(now, -15).getTime(),
    },
  ];
  return {
    profile: {
      name: "سارة (حساب تجريبي)",
      phone: DEMO_PHONE,
      hasPassword: false,
      homeArea: "dokki",
      home: { lat: areaById.dokki.lat, lng: areaById.dokki.lng },
      diet: ["no-pork"],
      moods: ["work", "friends", "breakfast"],
      inviteCode: "SARA-7K2Q",
      joined: ymd(addDays(now, -400)),
      demo: true,
    },
    favourites: favs,
    bookings,
    orders: [order(3, 4), order(22, 11), order(9, 26), order(51, 47)],
    wallet: restaurants
      .filter((r) => r.offers.length)
      .slice(0, 3)
      .map((r) => ({ offerId: r.offers[0].id, rid: r.id, code: r.offers[0].code, savedAt: addDays(now, -5).getTime() })),
    visits,
    points: 1240,
    plans: [],
  };
}

function fresh(): State {
  return { v: 1, current: DEMO_PHONE, accounts: { [DEMO_PHONE]: seedAccount() }, cart: null, guestArea: "downtown", recent: [] };
}

/* ───────────────────────── store core ───────────────────────── */
const KEY = "sufra.state.v1";
let state: State = (() => {
  const s = load<State | null>(KEY, null);
  if (!s || s.v !== 1 || !s.accounts) return fresh();
  // drop dangling ids if the dataset changed
  if (s.cart && !byId[s.cart.rid]) s.cart = null;
  return s;
})();
const listeners = new Set<() => void>();

export function getState() {
  return state;
}
export function setState(fn: (s: State) => State) {
  state = fn(state);
  save(KEY, state);
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}
export function resetDemo() {
  setState(() => fresh());
}

/* ───────────────────────── selectors & actions ───────────────────────── */
export const selAccount = (s: State): Account | null => (s.current ? (s.accounts[s.current] ?? null) : null);
export function useAccount() {
  return useStore(selAccount);
}
/**
 * Where distances are measured from: the live/last GPS fix when the user chose "استخدم موقعي",
 * otherwise the account's home, otherwise the guest's chosen area.
 */
export type OriginSource = "gps" | "home" | "area";
export function useHome(): { home: LatLng; areaId: string; isUser: boolean; source: OriginSource; label: string | null; accuracy: number | null } {
  const acc = useAccount();
  const guestArea = useStore((s) => s.guestArea);
  const loc = useLocation();
  return useMemo(() => {
    if (loc.active && loc.fix) {
      const home = { lat: loc.fix.lat, lng: loc.fix.lng };
      return { home, areaId: nearestArea(home).id, isUser: !!acc, source: "gps" as const, label: loc.fix.label, accuracy: loc.fix.accuracy };
    }
    if (acc) return { home: acc.profile.home, areaId: acc.profile.homeArea, isUser: true, source: "home" as const, label: null, accuracy: null };
    const a = areaById[guestArea] ?? areaById.downtown;
    return { home: { lat: a.lat, lng: a.lng }, areaId: a.id, isUser: false, source: "area" as const, label: null, accuracy: null };
    // loc.fix changes identity on every accepted fix; acc on account edits
  }, [loc.active, loc.fix, acc, guestArea]);
}

export function updateAccount(fn: (a: Account) => Account) {
  setState((s) => {
    if (!s.current || !s.accounts[s.current]) return s;
    return { ...s, accounts: { ...s.accounts, [s.current]: fn(s.accounts[s.current]) } };
  });
}
export function toggleFavourite(rid: string): boolean | null {
  const acc = selAccount(state);
  if (!acc) return null;
  const on = !acc.favourites.includes(rid);
  updateAccount((a) => ({ ...a, favourites: on ? [rid, ...a.favourites] : a.favourites.filter((x) => x !== rid) }));
  return on;
}
export function setGuestArea(id: string) {
  measureFromArea(); // picking an area means "measure from there", not from GPS
  setState((s) => ({ ...s, guestArea: id }));
}
export function pushRecent(rid: string) {
  setState((s) => ({ ...s, recent: [rid, ...s.recent.filter((x) => x !== rid)].slice(0, 12) }));
}
export function signOut() {
  setState((s) => ({ ...s, current: null }));
}
export function signIn(phone: string) {
  setState((s) => ({ ...s, current: s.accounts[phone] ? phone : s.current }));
}
export function createAccount(p: { phone: string; name: string; hasPassword: boolean; homeArea: string }) {
  const a = areaById[p.homeArea] ?? areaById.downtown;
  const code = (p.name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || "SFR") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const acc: Account = {
    profile: {
      name: p.name,
      phone: p.phone,
      hasPassword: p.hasPassword,
      homeArea: a.id,
      home: { lat: a.lat, lng: a.lng },
      diet: [],
      moods: [],
      inviteCode: code,
      joined: todayYmd(),
    },
    favourites: [],
    bookings: [],
    orders: [],
    wallet: [],
    visits: {},
    points: 100,
    plans: [],
  };
  setState((s) => ({ ...s, current: p.phone, accounts: { ...s.accounts, [p.phone]: acc } }));
}
export function addVisit(points = 0) {
  const d = todayYmd();
  updateAccount((a) => ({ ...a, visits: { ...a.visits, [d]: (a.visits[d] ?? 0) + 1 }, points: a.points + points }));
}

/* cart */
export function cartAdd(rid: string, itemId: string, delta = 1) {
  setState((s) => {
    let cart = s.cart && s.cart.rid === rid ? s.cart : { rid, lines: [] };
    const has = cart.lines.find((l) => l.itemId === itemId);
    let lines = has ? cart.lines.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + delta } : l)) : delta > 0 ? [...cart.lines, { itemId, qty: delta }] : cart.lines;
    lines = lines.filter((l) => l.qty > 0);
    cart = { rid, lines };
    return { ...s, cart: lines.length ? cart : null };
  });
}
export function cartClear() {
  setState((s) => ({ ...s, cart: null }));
}
export const cartCount = (s: State) => s.cart?.lines.reduce((a, l) => a + l.qty, 0) ?? 0;

/** Streak = consecutive days with activity ending today (or yesterday). */
export function streakOf(visits: Record<string, number>): number {
  let n = 0;
  let d = new Date();
  if (!visits[ymd(d)]) d = addDays(d, -1);
  while (visits[ymd(d)]) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

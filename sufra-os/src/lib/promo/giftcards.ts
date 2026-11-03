/**
 * Gift cards (pure). A card is a stored-value liability: selling one is cash in / gift-card liability up
 * (Dr cash, Cr 2204 "Deposits & gift cards"); redeeming one as a tender reduces the liability instead of cash
 * (the sale posts the tender to the house/clearing account, and a reclass entry moves it: Dr 2204, Cr receivables).
 * Breakage (expired balance) is recognised as other income when a card expires. See src/modules/marketing/DESIGN.md.
 */
import { roundMinor, type Units } from "@/lib/money";

export type GiftCardStatus = "active" | "redeemed" | "void" | "expired";

export interface GiftCardState {
  code: string;
  initial: Units;
  balance: Units;
  status: GiftCardStatus;
  expiresAt: string | null;
}

export type GiftCardTxnKind = "issue" | "redeem" | "topup" | "refund" | "void" | "expire";

export class GiftCardError extends Error {
  constructor(public code: "not_found" | "inactive" | "expired" | "insufficient" | "bad_amount" | "used") {
    super(code);
  }
}

const ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** "GC-7K2Q-9MXA-4" — 8 random chars + a check character (typos are caught before a lookup). */
export function giftCardCode(random: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < 8; i++) body += ALPHA[Math.floor(random() * ALPHA.length)];
  return `GC-${body.slice(0, 4)}-${body.slice(4)}-${checkChar(body)}`;
}
function checkChar(body: string) {
  let s = 0;
  for (let i = 0; i < body.length; i++) s = (s * 31 + ALPHA.indexOf(body[i]) + 1) % ALPHA.length;
  return ALPHA[s];
}
export const normalizeGiftCode = (c: string) => {
  const x = c.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = x.startsWith("GC") ? x.slice(2) : x;
  return body.length === 9 ? `GC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body[8]}` : c.trim().toUpperCase();
};
export function validGiftCode(c: string) {
  const m = /^GC-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9])$/.exec(normalizeGiftCode(c));
  return !!m && checkChar(m[1] + m[2]) === m[3];
}

export function isExpired(card: Pick<GiftCardState, "expiresAt">, now: Date) {
  return !!card.expiresAt && Date.parse(card.expiresAt) <= now.getTime();
}

/** Amount that can be taken from the card for a bill of `due`. */
export function usable(card: GiftCardState, due: Units, now: Date = new Date()): Units {
  if (card.status !== "active" || isExpired(card, now)) return 0;
  return Math.max(0, Math.min(card.balance, due));
}

/** Redeem (partial allowed). Returns the new state and the amount taken. */
export function redeemCard(card: GiftCardState, amount: Units, now: Date = new Date()): { card: GiftCardState; taken: Units } {
  if (amount <= 0) throw new GiftCardError("bad_amount");
  if (isExpired(card, now)) throw new GiftCardError("expired");
  if (card.status !== "active") throw new GiftCardError(card.status === "redeemed" ? "used" : "inactive");
  const a = roundMinor(amount);
  if (a > card.balance) throw new GiftCardError("insufficient");
  const balance = card.balance - a;
  return { card: { ...card, balance, status: balance === 0 ? "redeemed" : "active" }, taken: a };
}

export function topUp(card: GiftCardState, amount: Units, now: Date = new Date()): GiftCardState {
  if (amount <= 0) throw new GiftCardError("bad_amount");
  if (card.status === "void" || isExpired(card, now)) throw new GiftCardError("inactive");
  return { ...card, balance: card.balance + roundMinor(amount), status: "active" };
}

/** Undo a redemption (payment voided / refunded to the card). */
export function refundToCard(card: GiftCardState, amount: Units): GiftCardState {
  if (amount <= 0) throw new GiftCardError("bad_amount");
  return { ...card, balance: card.balance + roundMinor(amount), status: card.status === "redeemed" ? "active" : card.status };
}

/** Outstanding liability: balances of cards that can still be spent. */
export function liability(cards: GiftCardState[], now: Date = new Date()): Units {
  return cards.reduce((a, c) => a + (c.status === "active" && !isExpired(c, now) ? c.balance : 0), 0);
}

/** Balance implied by the transaction log (issue/topup/refund +, redeem/expire/void −). */
export function balanceFromTxns(txns: { kind: GiftCardTxnKind; amount: Units }[]): Units {
  return txns.reduce((a, t) => a + (t.kind === "issue" || t.kind === "topup" || t.kind === "refund" ? t.amount : -t.amount), 0);
}

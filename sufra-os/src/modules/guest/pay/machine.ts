/**
 * Client-side payment flow as a small state machine (pure; tested in machine.test.ts).
 *
 *   idle ─START─▶ creating ─CREATED─▶ redirect ─RETURNED─▶ verifying ─STATUS(succeeded)─▶ succeeded ─RECORDED─▶ done
 *                     │                   │                     │
 *                     └─FAILED─▶ failed   └─CANCEL─▶ cancelled  ├─STATUS(failed)─▶ failed
 *                                                               ├─STATUS(cancelled)─▶ cancelled
 *                                                               └─STATUS(expired) / TIMEOUT─▶ expired
 *   failed | cancelled | expired | done ─RETRY─▶ idle  (done: start another payment, e.g. the next share)
 *
 * Invalid events leave the state unchanged (a late webhook poll can't "un-pay" a payment, a double
 * tap can't create two intents).
 */
import type { IntentStatus, PaymentIntent } from "./types";

export type PayState =
  | { s: "idle" }
  | { s: "creating" }
  | { s: "redirect"; intent: PaymentIntent }
  | { s: "verifying"; intentId: string; polls: number }
  | { s: "succeeded"; intent: PaymentIntent }
  | { s: "done"; intent: PaymentIntent }
  | { s: "failed"; error: string; intentId: string | null }
  | { s: "cancelled"; intentId: string | null }
  | { s: "expired"; intentId: string | null };

export type PayEvent =
  | { t: "START" }
  | { t: "CREATED"; intent: PaymentIntent }
  | { t: "FAILED"; error: string }
  | { t: "RETURNED"; intentId: string }
  | { t: "STATUS"; intent: PaymentIntent }
  | { t: "TIMEOUT" }
  | { t: "CANCEL" }
  | { t: "RECORDED" }
  | { t: "RETRY" };

/** polls of ~2s before we give up waiting for the webhook */
export const MAX_POLLS = 45;

const terminal = (status: IntentStatus, intent: PaymentIntent): PayState | null => {
  switch (status) {
    case "succeeded":
      return { s: "succeeded", intent };
    case "failed":
      return { s: "failed", error: intent.failureReason ?? "declined", intentId: intent.id };
    case "cancelled":
      return { s: "cancelled", intentId: intent.id };
    case "expired":
      return { s: "expired", intentId: intent.id };
    default:
      return null;
  }
};

export function payReducer(state: PayState, e: PayEvent): PayState {
  switch (state.s) {
    case "idle":
      if (e.t === "START") return { s: "creating" };
      if (e.t === "RETURNED") return { s: "verifying", intentId: e.intentId, polls: 0 };
      return state;
    case "creating":
      if (e.t === "CREATED") return terminal(e.intent.status, e.intent) ?? { s: "redirect", intent: e.intent };
      if (e.t === "FAILED") return { s: "failed", error: e.error, intentId: null };
      return state;
    case "redirect":
      if (e.t === "RETURNED" && e.intentId === state.intent.id) return { s: "verifying", intentId: e.intentId, polls: 0 };
      if (e.t === "CANCEL") return { s: "cancelled", intentId: state.intent.id };
      if (e.t === "STATUS" && e.intent.id === state.intent.id) return terminal(e.intent.status, e.intent) ?? state;
      return state;
    case "verifying":
      if (e.t === "STATUS" && e.intent.id === state.intentId) {
        const end = terminal(e.intent.status, e.intent);
        if (end) return end;
        return state.polls + 1 >= MAX_POLLS ? { s: "expired", intentId: state.intentId } : { ...state, polls: state.polls + 1 };
      }
      if (e.t === "TIMEOUT") return { s: "expired", intentId: state.intentId };
      return state;
    case "succeeded":
      if (e.t === "RECORDED") return { s: "done", intent: state.intent };
      return state;
    case "failed":
    case "cancelled":
    case "expired":
      if (e.t === "RETRY") return { s: "idle" };
      return state;
    case "done":
      if (e.t === "RETRY") return { s: "idle" };
      return state;
  }
}

export const isBusy = (st: PayState) => st.s === "creating" || st.s === "redirect" || st.s === "verifying";

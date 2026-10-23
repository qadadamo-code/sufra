import { describe, expect, it } from "vitest";
import { major } from "@/lib/money";
import { isBusy, MAX_POLLS, payReducer, type PayEvent, type PayState } from "./machine";
import { demoProvider } from "./demo";
import type { PaymentIntent, PaymentRequest } from "./types";

const req: PaymentRequest = { restaurantSlug: "sufra-zamalek", purpose: "check", checkId: "c1", orderId: null, tableCode: "ZM05", amount: major(250), tip: major(25), currency: "EGP", splitLabel: "1 of 2", customer: null, returnUrl: "http://x/app/r/sufra-zamalek/t/ZM05", lang: "ar" };
const intent = (status: PaymentIntent["status"], id = "pi_1"): PaymentIntent => ({ id, provider: "demo", status, charge: major(275), amount: major(250), tip: major(25), currency: "EGP", redirectUrl: status === "requires_action" ? "/pay" : null, reference: status === "succeeded" ? "REF" : null, failureReason: status === "failed" ? "card_declined" : null, createdAt: "", expiresAt: "", request: req });
const run = (events: PayEvent[], from: PayState = { s: "idle" }) => events.reduce(payReducer, from);

describe("payment state machine", () => {
  it("happy path: idle → creating → redirect → verifying → succeeded → done", () => {
    const st = run([{ t: "START" }, { t: "CREATED", intent: intent("requires_action") }, { t: "RETURNED", intentId: "pi_1" }, { t: "STATUS", intent: intent("processing") }, { t: "STATUS", intent: intent("succeeded") }, { t: "RECORDED" }]);
    expect(st.s).toBe("done");
  });

  it("failures, cancels and retry", () => {
    expect(run([{ t: "START" }, { t: "FAILED", error: "network" }]).s).toBe("failed");
    expect(run([{ t: "START" }, { t: "CREATED", intent: intent("requires_action") }, { t: "CANCEL" }]).s).toBe("cancelled");
    expect(run([{ t: "RETURNED", intentId: "pi_1" }, { t: "STATUS", intent: intent("failed") }]).s).toBe("failed");
    expect(run([{ t: "START" }, { t: "FAILED", error: "x" }, { t: "RETRY" }]).s).toBe("idle");
  });

  it("ignores invalid events: double START, late statuses, statuses for another intent", () => {
    const creating = run([{ t: "START" }, { t: "START" }]);
    expect(creating.s).toBe("creating");
    const done = run([{ t: "RETURNED", intentId: "pi_1" }, { t: "STATUS", intent: intent("succeeded") }, { t: "RECORDED" }]);
    expect(payReducer(done, { t: "STATUS", intent: intent("failed") }).s).toBe("done");
    const verifying = run([{ t: "RETURNED", intentId: "pi_1" }]);
    expect(payReducer(verifying, { t: "STATUS", intent: intent("succeeded", "pi_other") })).toBe(verifying);
    expect(payReducer({ s: "succeeded", intent: intent("succeeded") }, { t: "CANCEL" }).s).toBe("succeeded");
  });

  it("gives up after MAX_POLLS pending statuses", () => {
    let st: PayState = run([{ t: "RETURNED", intentId: "pi_1" }]);
    for (let i = 0; i < MAX_POLLS; i++) st = payReducer(st, { t: "STATUS", intent: intent("processing") });
    expect(st.s).toBe("expired");
    expect(isBusy(st)).toBe(false);
  });

  it("DemoProvider: create → complete → retrieve, and refuses to re-complete", async () => {
    const pi = await demoProvider.createIntent(req);
    expect(pi.status).toBe("requires_action");
    expect(pi.charge).toBe(major(275));
    expect(pi.redirectUrl).toContain(`/r/sufra-zamalek/pay/${pi.id}`);
    const ok = await demoProvider.complete(pi.id, "succeeded");
    expect(ok?.status).toBe("succeeded");
    expect(ok?.reference).toMatch(/^DEMO-/);
    expect((await demoProvider.complete(pi.id, "failed"))?.status).toBe("succeeded");
    expect((await demoProvider.retrieve(pi.id))?.status).toBe("succeeded");
    await expect(demoProvider.createIntent({ ...req, amount: 0 })).rejects.toThrow();
  });
});

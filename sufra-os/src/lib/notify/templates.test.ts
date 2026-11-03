import { describe, expect, it } from "vitest";
import { CATALOG, metaSubmission, renderSample, renderTemplate, TemplateRenderError, templateSendParams, urlSuffix, varsOf, PUBLIC_BASE } from "./templates";
import { placeholders } from "./core";

describe("template catalogue", () => {
  it("covers the catalogue's must-have templates", () => {
    const ids = CATALOG.map((t) => t.id);
    for (const id of ["otp_login", "order_received", "order_accepted_eta", "order_ready_pickup", "order_out_for_delivery", "order_delivered_receipt", "order_cancelled", "order_delayed", "payment_link", "payment_received", "refund_processed", "reservation_confirmed", "reservation_reminder", "waitlist_table_ready", "feedback_request"])
      expect(ids, id).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template renders AR + EN with its samples, same variables in both, names Meta-valid", () => {
    for (const t of CATALOG) {
      expect(t.id).toMatch(/^[a-z0-9_]+$/);
      expect(new Set(placeholders(t.body.ar))).toEqual(new Set(placeholders(t.body.en)));
      for (const v of varsOf(t.id)) expect(t.sample[v], `${t.id}.${v}`).toBeTruthy();
      for (const lang of ["ar", "en"] as const) expect(renderSample(t.id, lang)).not.toMatch(/\{\{|\}\}/);
      if (t.button) expect(varsOf(t.id)).toContain(t.button.urlVar);
    }
  });

  it("marketing templates carry an opt-out footer; utility templates have no promo wording", () => {
    for (const t of CATALOG.filter((x) => x.category === "MARKETING")) expect(t.footer?.ar).toMatch(/وقف/);
    for (const t of CATALOG.filter((x) => x.category === "UTILITY")) expect(`${t.body.ar} ${t.body.en}`).not.toMatch(/خصم|عرض|discount|offer|promo|%/i);
  });

  it("refuses a missing variable", () => {
    expect(() => renderTemplate("feedback_request", "ar", { name: "Dina" })).toThrow(TemplateRenderError);
    expect(() => renderTemplate("nope", "ar", {})).toThrow(TemplateRenderError);
  });

  it("send params: positional body params + URL button suffix", () => {
    const p = templateSendParams("feedback_request", "en", { name: "Dina", restaurant: "Sufra", number: 42, rate_link: `${PUBLIC_BASE}r/sufra-zamalek/o/abc#rate` });
    expect(p).toEqual({ name: "feedback_request", lang: "en", params: ["Sufra", "Dina", "42", `${PUBLIC_BASE}r/sufra-zamalek/o/abc#rate`], buttonParams: ["r/sufra-zamalek/o/abc#rate"] });
    expect(urlSuffix("http://localhost:5173/app/r/x/o/1#rate")).toBe("r/x/o/1#rate");
  });

  it("Meta submission JSON: positional body with examples, footer, URL + quick-reply buttons", () => {
    const m = metaSubmission("order_out_for_delivery", "ar") as { name: string; category: string; language: string; components: { type: string; text?: string; example?: { body_text: string[][] }; buttons?: { type: string; url?: string }[] }[] };
    expect(m).toMatchObject({ name: "order_out_for_delivery", category: "UTILITY", language: "ar" });
    const body = m.components.find((c) => c.type === "BODY")!;
    expect(body.text).toContain("{{1}}");
    expect(body.text).not.toMatch(/\{\{[a-z]/);
    expect(body.example!.body_text[0].length).toBe(placeholders(body.text!).length);
    expect(m.components.find((c) => c.type === "BUTTONS")!.buttons![0]).toMatchObject({ type: "URL", url: `${PUBLIC_BASE}{{1}}` });
    const r = metaSubmission("reservation_reminder", "en") as { components: { type: string; buttons?: { type: string }[] }[] };
    expect(r.components.find((c) => c.type === "BUTTONS")!.buttons!.map((b) => b.type)).toEqual(["QUICK_REPLY", "QUICK_REPLY"]);
    const w = metaSubmission("win_back_offer", "ar") as { category: string; components: { type: string }[] };
    expect(w.category).toBe("MARKETING");
    expect(w.components.map((c) => c.type)).toContain("FOOTER");
    const otp = metaSubmission("otp_login", "en") as { category: string; components: { type: string; buttons?: { otp_type: string }[] }[] };
    expect(otp.category).toBe("AUTHENTICATION");
    expect(otp.components.find((c) => c.type === "BUTTONS")!.buttons![0].otp_type).toBe("COPY_CODE");
  });
});

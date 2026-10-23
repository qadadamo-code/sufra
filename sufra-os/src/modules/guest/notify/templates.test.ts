import { afterEach, describe, expect, it } from "vitest";
import { render, STAGE_TEMPLATE, TEMPLATES, TemplateError, templateVars, toMeta, type TemplateId } from "./templates";
import { LogNotifier, toE164 } from "./notifier";

const IDS = Object.keys(TEMPLATES) as TemplateId[];

describe("WhatsApp templates", () => {
  it("every template renders in AR and EN with its sample values and leaves no placeholder", () => {
    for (const id of IDS)
      for (const lang of ["ar", "en"] as const) {
        const out = render(id, lang, TEMPLATES[id].sample);
        expect(out, `${id}/${lang}`).not.toMatch(/\{\{|\}\}/);
        expect(out.length).toBeGreaterThan(20);
      }
  });

  it("AR and EN use the same variables, and every variable has a sample (Meta review)", () => {
    for (const id of IDS) {
      const ar = [...TEMPLATES[id].body.ar.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
      const en = [...TEMPLATES[id].body.en.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
      expect(new Set(ar), id).toEqual(new Set(en));
      for (const v of templateVars(id)) expect(TEMPLATES[id].sample[v], `${id}.${v}`).toBeTruthy();
      if (TEMPLATES[id].button) expect(templateVars(id)).toContain(TEMPLATES[id].button!.urlVar);
      expect(TEMPLATES[id].category).toBe("UTILITY");
      expect(id).toMatch(/^[a-z_]+$/);
    }
  });

  it("refuses to render with a missing or empty variable", () => {
    const { driver_phone: _, ...rest } = TEMPLATES.order_out_for_delivery.sample;
    expect(() => render("order_out_for_delivery", "ar", rest)).toThrow(TemplateError);
    expect(() => render("order_out_for_delivery", "en", { ...rest, driver_phone: "  " })).toThrow(/driver_phone/);
  });

  it("out-for-delivery carries driver name, phone and tracking link", () => {
    const s = render("order_out_for_delivery", "en", { number: 42, driver_name: "Islam", driver_phone: "01000000001", eta: "21:05", link: "https://x.test/o/1" });
    expect(s).toContain("Islam");
    expect(s).toContain("01000000001");
    expect(s).toContain("https://x.test/o/1");
  });

  it("variables can't inject newlines (WhatsApp param rule)", () => {
    const s = render("order_delayed", "en", { name: "A\nB", number: 1, eta: "21:00", reason: "x\t\ty" });
    expect(s).toContain("A B");
    expect(s).toContain("x y");
  });

  it("converts to Meta positional placeholders with examples", () => {
    const m = toMeta("order_received", "ar");
    expect(m.body).not.toMatch(/\{\{[a-z]/);
    expect(m.body).toContain("{{1}}");
    expect(m.params[0]).toBe("name");
    expect(m.example).toHaveLength(m.params.length);
  });

  it("maps every order stage to a template", () => {
    for (const t of Object.values(STAGE_TEMPLATE)) expect(IDS).toContain(t);
  });
});

describe("LogNotifier", () => {
  const n = new LogNotifier(`test-outbox-${Math.random()}`);
  afterEach(() => n.clear());

  it("records rendered messages and dedupes per key", async () => {
    const m = await n.send({ restaurantId: "r1", to: "01005551201", lang: "ar", template: "order_accepted_eta", vars: { name: "دينا", number: 7, eta: "20:30", link: "https://x" }, dedupeKey: "o1:accepted" });
    expect(m?.to).toBe("+201005551201");
    expect(m?.text).toContain("دينا");
    expect(await n.send({ restaurantId: "r1", to: "01005551201", lang: "ar", template: "order_accepted_eta", vars: { name: "دينا", number: 7, eta: "20:30", link: "https://x" }, dedupeKey: "o1:accepted" })).toBeNull();
    expect(n.list("r1")).toHaveLength(1);
    expect(n.list("r2")).toHaveLength(0);
    n.close();
  });

  it("normalises Egyptian mobiles to E.164", () => {
    expect(toE164("010 0555 1201")).toBe("+201005551201");
    expect(toE164("+201005551201")).toBe("+201005551201");
  });
});

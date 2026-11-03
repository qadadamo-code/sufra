#!/usr/bin/env node
/**
 * Wave 2 CRM / marketing / platform screenshots at 390, 1024 and 1440 (light AR, dark EN at 390 + 1440).
 *   npm run build && npx vite preview --port 4318 &
 *   node scripts/shots-crm.mjs http://127.0.0.1:4318/app/ ./shots-crm
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:4318/app/";
const OUT = process.argv[3] || "shots-crm";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
fs.mkdirSync(OUT, { recursive: true });

// same deterministic ids as src/lib/id.ts seedId
function seedId(name) {
  const b = new Uint8Array(16);
  for (let lane = 0; lane < 4; lane++) {
    let h = 0x811c9dc5 ^ (lane * 0x9e3779b1);
    const s = `${lane}:${name}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h >>>= 0;
    b[lane * 4] = h >>> 24;
    b[lane * 4 + 1] = (h >>> 16) & 255;
    b[lane * 4 + 2] = (h >>> 8) & 255;
    b[lane * 4 + 3] = h & 255;
  }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const id = (k) => seedId(`sufra-zamalek:${k}`);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const errors = [];

async function ctxFor(width, theme, lang) {
  const mobile = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme, reducedMotion: "reduce" });
  await ctx.addInitScript(([t, l, card]) => {
    try {
      localStorage.setItem("sufra-os.theme", t);
      localStorage.setItem("sufra-os.lang", l);
      localStorage.setItem("sufra-guest.card.sufra-zamalek", card);
    } catch {}
  }, [theme, lang, JSON.stringify({ customerId: id("customer:6"), phone: "01005551206" })]);
  return ctx;
}
async function shot(page, name, full = false) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("✓", name);
}
async function pinLogin(page, name, pin) {
  await page.evaluate(() => localStorage.removeItem("sufra-os.pinSession"));
  await page.goto(BASE + "login/pin", { waitUntil: "networkidle" });
  await page.getByRole("button", { name }).first().click();
  await page.locator("[aria-label='رقم 1'], [aria-label='Digit 1']").first().waitFor();
  await page.waitForTimeout(150);
  for (const d of pin) await page.keyboard.press(d);
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 8000 });
  await page.waitForTimeout(600);
}
const want = (k) => !ONLY || ONLY.includes(k);

const combos = [
  [1440, "light", "ar"],
  [1024, "light", "ar"],
  [390, "light", "ar"],
  [1440, "dark", "en"],
  [390, "dark", "en"],
];
for (const [w, theme, lang] of combos) {
  const tag = `${w}-${theme}-${lang}`;
  const ctx = await ctxFor(w, theme, lang);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${tag} console: ${m.text()}`));
  await page.goto(BASE + "login", { waitUntil: "networkidle" });

  await pinLogin(page, "كريم الشريف", "1000");
  const go = async (p, name, full) => {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await shot(page, `${name}-${tag}`, full);
  };
  if (want("customers")) {
    await go("customers", "customers-list");
    await go(`customers/${id("customer:6")}`, "customer-profile");
    await go("customers/segments", "segments");
  }
  if (want("loyalty")) await go("marketing/loyalty", "loyalty-settings");
  if (want("campaigns")) {
    await go(`marketing/campaigns/new?segment=${id("segment:winback")}`, "campaign-composer");
    await go(`marketing/campaigns/${id("campaign:winback")}`, "campaign-results");
  }
  if (want("marketing")) {
    await go("marketing", "marketing-overview");
    await go("marketing/promotions", "promotions");
    await go("marketing/promos", "own-promos");
    await go("marketing/reviews", "reviews");
    await go("marketing/reports", "customer-reports");
    await go("marketing/ads", "buy-ad");
  }
  if (want("guest")) {
    await go("r/sufra-zamalek/t/ZM05", "guest-qr-menu-promos");
    await go("r/sufra-zamalek", "guest-online-promos");
    await go("r/sufra-zamalek/me", "guest-loyalty-card");
    await go("r/sufra-zamalek/gift", "guest-gift-card");
  }
  if (want("pos")) {
    await pinLogin(page, "سارة حسني", "4000");
    await page.goto(BASE + `pos?check=${id("check:t5")}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.keyboard.press("c");
    const input = page.locator("input[placeholder='SUFRA15']").first();
    await input.waitFor({ timeout: 5000 });
    await input.fill("SUFRA15");
    await input.press("Enter");
    await page.waitForTimeout(700);
    await shot(page, `pos-promo-dialog-${tag}`);
    await page.getByRole("button", { name: lang === "ar" ? /^طبّق/ : /^Apply/ }).last().click();
    await page.waitForTimeout(900);
    await shot(page, `pos-coupon-applied-${tag}`);
  }
  if (want("platform")) {
    await pinLogin(page, "فريق منصة سُفرة", "0000");
    await shot(page, `platform-sponsored-${tag}`);
    await go("platform/performance", "platform-performance");
    await go("platform/restaurants", "platform-restaurants");
  }
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.log("\nPage errors:\n" + [...new Set(errors)].join("\n"));
  process.exitCode = 1;
}

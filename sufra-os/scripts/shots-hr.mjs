#!/usr/bin/env node
/**
 * Wave 3 HR screenshots (staff, rota, attendance, leave, advances, payroll, /me, /timeclock) at 390 + 1440, light/dark, AR/EN.
 *   npm run build && npx vite preview --port 4318 &
 *   node scripts/shots-hr.mjs http://127.0.0.1:4318/app/ ./shots-hr
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:4318/app/";
const OUT = process.argv[3] || "shots-hr";
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
  [1440, "dark", "en"],
  [390, "light", "ar"],
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
  const go = async (p, name, full = false) => {
    if (!want(name)) return;
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await shot(page, `${name}-${tag}`, full);
  };
  await go("staff", "team");
  await go(`staff/p/${id("staff:waiter2")}`, "profile");
  await go("staff/schedule", "rota");
  await go("staff/attendance", "attendance");
  await go("staff/leave", "leave");
  await go("staff/advances", "advances");
  await go("staff/payroll", "payroll");
  await go(`staff/payroll/run/${id("hr:run:last")}`, "payroll-run");
  await go(`staff/payroll/slip/${id("hr:slip:waiter2")}`, "payslip");
  await go("staff/performance", "performance");
  await go("staff/settings", "hr-settings");
  await pinLogin(page, "أحمد سمير", "5000");
  await go("me", "me");
  if (want("me-leave")) {
    await page.goto(BASE + "me", { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: lang === "ar" ? "إجازاتي" : "Leave" }).first().click().catch(() => {});
    await shot(page, `me-leave-${tag}`);
  }
  await go("timeclock", "timeclock");
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.log("\nERRORS:\n" + [...new Set(errors)].join("\n"));
  process.exitCode = 1;
}

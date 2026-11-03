#!/usr/bin/env node
/**
 * Screenshots of accounting + reports at 1440 / 1024 / 390, light/dark, AR/EN, signed in as the accountant (PIN 9000)
 * and the owner overview (PIN 1000).
 *   npx vite preview --port 4318 &   (or npm run dev)
 *   node scripts/shots-accounting.mjs http://127.0.0.1:4318/app/ ./shots-accounting
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:4318/app/";
const OUT = process.argv[3] || "shots-accounting";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["acct-cash", "accounting"],
  ["acct-journal", "accounting/journal"],
  ["acct-expenses", "accounting/expenses"],
  ["acct-treasury", "accounting/treasury"],
  ["acct-bank", "accounting/bank"],
  ["acct-vat", "accounting/vat"],
  ["acct-chart", "accounting/chart"],
  ["acct-close", "accounting/close"],
  ["acct-export", "accounting/export"],
  ["rep-sales", "reports"],
  ["rep-items", "reports/items"],
  ["rep-staff", "reports/staff"],
  ["rep-pnl", "reports/pnl"],
  ["rep-bs", "reports/bs"],
  ["rep-tb", "reports/tb"],
  ["rep-cashflow", "reports/cashflow"],
  ["rep-liabilities", "reports/liabilities"],
];
const KEY = new Set(["acct-cash", "acct-journal", "acct-expenses", "acct-bank", "rep-pnl", "rep-items", "rep-sales"]);
const combos = [
  [1440, "light", "ar", "all"],
  [1440, "dark", "en", "all"],
  [1024, "light", "en", "key"],
  [1024, "dark", "ar", "key"],
  [390, "light", "ar", "key"],
  [390, "dark", "en", "key"],
];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const errors = [];

async function ctxFor(width, theme, lang) {
  const mobile = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme, reducedMotion: "reduce" });
  await ctx.addInitScript(([t, l]) => {
    try {
      localStorage.setItem("sufra-os.theme", t);
      localStorage.setItem("sufra-os.lang", l);
    } catch {}
  }, [theme, lang]);
  return ctx;
}
async function pinLogin(page, name, pin) {
  await page.goto(BASE + "login/pin", { waitUntil: "networkidle" });
  await page.getByRole("button", { name }).first().click();
  await page.locator("[aria-label='رقم 1'], [aria-label='Digit 1']").first().waitFor();
  await page.waitForTimeout(150);
  for (const d of pin) await page.keyboard.press(d);
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForTimeout(900);
}
async function shot(page, name, full = true) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push(`${name}: horizontal overflow ${overflow}px`);
  console.log("✓", name);
}

for (const [w, theme, lang, set] of combos) {
  const tag = `${w}-${theme}-${lang}`;
  const ctx = await ctxFor(w, theme, lang);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text()}`));
  await page.goto(BASE + "login", { waitUntil: "networkidle" });
  if (!ONLY || ONLY.includes("overview")) {
    await pinLogin(page, "كريم الشريف", "1000");
    await page.goto(BASE + "overview", { waitUntil: "networkidle" });
    await shot(page, `overview-owner-${tag}`, false);
    await page.evaluate(() => localStorage.removeItem("sufra-os.pinSession"));
  }
  await pinLogin(page, "هالة منصور", "9000");
  for (const [name, path] of PAGES) {
    if (set === "key" && !KEY.has(name)) continue;
    if (ONLY && !ONLY.includes(name)) continue;
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await shot(page, `${name}-${tag}`);
  }
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.log("\nIssues:\n" + [...new Set(errors)].join("\n"));
  process.exitCode = 1;
}

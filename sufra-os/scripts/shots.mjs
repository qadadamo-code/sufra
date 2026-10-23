#!/usr/bin/env node
/**
 * Screenshots of the main screens at phone (390) and desktop (1440), light/dark, AR/EN.
 *   npm run build && npx vite preview --port 4318 &
 *   node scripts/shots.mjs http://127.0.0.1:4318/app/ ./shots
 * Logs in through the real PIN screen (demo PINs from README).
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:4318/app/";
const OUT = process.argv[3] || "shots";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
fs.mkdirSync(OUT, { recursive: true });

const ROLES = [
  ["owner", "كريم الشريف", "1000"],
  ["manager", "تامر فؤاد", "3000"],
  ["cashier", "سارة حسني", "4000"],
  ["waiter", "أحمد سمير", "5000"],
  ["chef", "الشيف صابر", "6000"],
  ["delivery", "إسلام جمال", "8000"],
  ["accountant", "هالة منصور", "9000"],
];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const errors = [];

async function ctxFor(width, theme, lang) {
  const mobile = width < 600;
  const ctx = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  await ctx.addInitScript(([t, l]) => {
    try {
      localStorage.setItem("sufra-os.theme", t);
      localStorage.setItem("sufra-os.lang", l);
    } catch {}
  }, [theme, lang]);
  return ctx;
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("✓", name);
}

async function pinLogin(page, name, pin) {
  await page.goto(BASE + "login/pin", { waitUntil: "networkidle" });
  await page.getByRole("button", { name }).first().click();
  await page.locator("[aria-label='رقم 1'], [aria-label='Digit 1']").first().waitFor();
  await page.waitForTimeout(150);
  for (const d of pin) await page.keyboard.press(d);
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 8000 });
  await page.waitForTimeout(700);
}

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
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text()}`));

  if (!ONLY || ONLY.includes("login")) {
    await page.goto(BASE + "login", { waitUntil: "networkidle" });
    await shot(page, `login-${tag}`);
    await page.goto(BASE + "login/pin", { waitUntil: "networkidle" });
    await shot(page, `pin-${tag}`);
    await page.getByRole("button", { name: "سارة حسني" }).first().click();
    await page.locator("[aria-label='رقم 1'], [aria-label='Digit 1']").first().waitFor();
    await page.waitForTimeout(150);
    await page.keyboard.press("4");
    await page.keyboard.press("0");
    await shot(page, `pinpad-${tag}`);
  }
  if (page.url() === "about:blank") await page.goto(BASE + "login", { waitUntil: "networkidle" });
  for (const [role, name, pin] of ROLES) {
    if (ONLY && !ONLY.includes(role)) continue;
    await page.evaluate(() => localStorage.removeItem("sufra-os.pinSession"));
    await pinLogin(page, name, pin);
    await shot(page, `role-${role}-${tag}`);
  }
  if (!ONLY || ONLY.includes("extras")) {
    await page.evaluate(() => localStorage.removeItem("sufra-os.pinSession"));
    await pinLogin(page, "كريم الشريف", "1000");
    await page.goto(BASE + "settings/tax", { waitUntil: "networkidle" });
    await shot(page, `settings-tax-${tag}`);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await shot(page, `palette-${tag}`);
    await page.keyboard.press("Escape");
    await page.goto(BASE + "r/sufra-zamalek/t/ZM05", { waitUntil: "networkidle" });
    await shot(page, `guest-table-${tag}`);
    await page.getByRole("button", { name: lang === "ar" ? "نادي الجرسون" : "Call a waiter" }).click();
    await shot(page, `guest-call-${tag}`);
  }
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.log("\nPage errors:\n" + [...new Set(errors)].join("\n"));
  process.exitCode = 1;
}

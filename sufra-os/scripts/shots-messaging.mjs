#!/usr/bin/env node
/**
 * Messaging screenshots (inbox, conversation, templates, settings, click-to-chat flow) at 390 + 1440, light/dark, AR/EN.
 *   npx vite --port 4319 &   (or vite preview)
 *   node scripts/shots-messaging.mjs http://127.0.0.1:4319/app/ ./shots
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:4319/app/";
const OUT = process.argv[3] || "shots";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const errors = [];
const combos = [
  [1440, "light", "ar"],
  [1440, "dark", "en"],
  [390, "light", "ar"],
  [390, "dark", "en"],
  [1440, "dark", "ar"],
  [390, "light", "en"],
];
for (const [w, theme, lang] of combos) {
  const tag = `${w}-${theme}-${lang}`;
  const mobile = w < 600;
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme, reducedMotion: "reduce" });
  await ctx.addInitScript(([t, l]) => { try { localStorage.setItem("sufra-os.theme", t); localStorage.setItem("sufra-os.lang", l); } catch {} }, [theme, lang]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|api\/whatsapp/.test(m.text()) && errors.push(`${tag} console: ${m.text()}`));
  const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${name}-${tag}.png` }); console.log("✓", name, tag); };
  // login as cashier (messages.use) — owner for settings
  const login = async (name, pin) => {
    await page.goto(BASE + "login/pin", { waitUntil: "networkidle" });
    await page.getByRole("button", { name }).first().click();
    await page.locator("[aria-label='رقم 1'], [aria-label='Digit 1']").first().waitFor();
    await page.waitForTimeout(150);
    for (const d of pin) await page.keyboard.press(d);
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 10000 });
    await page.waitForTimeout(600);
  };
  await login("كريم الشريف", "1000");
  await page.goto(BASE + "messages", { waitUntil: "networkidle" });
  await shot("inbox");
  // open Osama's conversation (delivery) — on phones the list shows first
  await page.getByRole("button", { name: /أسامة جلال/ }).first().click();
  await shot("conversation");
  // template sheet
  await page.getByRole("button", { name: lang === "ar" ? "إرفاق" : "Attach" }).click();
  await page.getByRole("menuitem", { name: lang === "ar" ? "قالب واتساب" : "WhatsApp template" }).click();
  await shot("template-sheet");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // click-to-chat flow: type + send → popup to wa.me
  const box = page.locator("textarea[id^='draft-']");
  await box.fill(lang === "ar" ? "الطيار على بعد ٥ دقايق 🛵" : "The rider is 5 minutes away 🛵");
  const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null), page.getByRole("button", { name: lang === "ar" ? "ابعت" : "Send", exact: true }).click()]);
  await page.waitForTimeout(800);
  if (popup) { await popup.waitForTimeout(400); console.log("  popup:", popup.url().slice(0, 80)); await popup.close().catch(() => {}); }
  await shot("click-to-chat-sent");
  // to-send queue
  await page.goto(BASE + "messages", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: lang === "ar" ? /للإرسال/ : /To send/ }).click().catch(() => {});
  await shot("to-send");
  await page.goto(BASE + "messages/templates", { waitUntil: "networkidle" });
  await shot("templates");
  await page.goto(BASE + "messages/consent", { waitUntil: "networkidle" });
  await shot("consent");
  await page.goto(BASE + "messages/log", { waitUntil: "networkidle" });
  await shot("log");
  await page.goto(BASE + "settings/messaging", { waitUntil: "networkidle" });
  await shot("settings");
  await page.mouse.wheel(0, 1600);
  await shot("settings-lower");
  // guest checkout consent
  await page.goto(BASE + "r/sufra-zamalek", { waitUntil: "networkidle" });
  await ctx.close();
}
await browser.close();
if (errors.length) { console.log("\nPage errors:\n" + [...new Set(errors)].join("\n")); process.exitCode = 1; }

#!/usr/bin/env node
/**
 * Wave 3 inventory / menu manager screenshots at 1440, 1024 and 390 (light AR, dark EN), plus an end-to-end check that
 * selling an item in the POS takes its recipe out of stock.
 *   npm run build && npx vite preview --port 4318 &
 *   node scripts/shots-inventory.mjs http://127.0.0.1:4318/app/ ./shots-inventory
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:4318/app/";
const OUT = process.argv[3] || "shots-inventory";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
fs.mkdirSync(OUT, { recursive: true });

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
const want = (k) => !ONLY || ONLY.includes(k);

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
/** on hand of a stock item from the local IndexedDB (sum of its levels) */
async function onHand(page, itemId) {
  return page.evaluate(
    (iid) =>
      new Promise((resolve) => {
        const req = indexedDB.open("sufra-os");
        req.onsuccess = () => {
          const tx = req.result.transaction("rows", "readonly");
          const all = tx.objectStore("rows").index("c").getAll("stockLevels");
          all.onsuccess = () => resolve(all.result.filter((r) => r.row.itemId === iid).reduce((a, r) => a + r.row.qty, 0));
        };
      }),
    itemId,
  );
}

const combos = [
  [1440, "light", "ar"],
  [1024, "light", "ar"],
  [390, "light", "ar"],
  [1440, "dark", "en"],
  [1024, "dark", "en"],
  [390, "dark", "en"],
];
let verified = false;
for (const [w, theme, lang] of combos) {
  const tag = `${w}-${theme}-${lang}`;
  const ctx = await ctxFor(w, theme, lang);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${tag} console: ${m.text()}`));
  await page.goto(BASE + "login", { waitUntil: "networkidle" });
  await pinLogin(page, "كريم الشريف", "1000");
  const go = async (p, name, full = false) => {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await shot(page, `${name}-${tag}`, full);
  };
  const click = async (re) => {
    const b = page.getByRole("button", { name: re }).or(page.getByRole("radio", { name: re })).or(page.getByRole("tab", { name: re })).first();
    await b.click({ timeout: 5000 }).catch((e) => errors.push(`${tag}: click ${re}: ${e.message.split("\n")[0]}`));
    await page.waitForTimeout(500);
  };
  if (want("overview")) await go("inventory", "inv-overview");
  if (want("items")) {
    await go("inventory/items", "inv-items");
    await page.getByRole("row").nth(3).click().catch(() => {});
    await shot(page, `inv-item-sheet-${tag}`);
  }
  if (want("recipes")) {
    await go("inventory/recipes", "inv-recipes");
    await page.getByRole("row").nth(1).click().catch(() => {});
    await shot(page, `inv-recipe-editor-${tag}`);
  }
  if (want("moves")) {
    await go("inventory/moves", "inv-moves");
    await click(/^(هالك|Waste)$/);
    await shot(page, `inv-waste-dialog-${tag}`);
  }
  if (want("counts")) {
    await go("inventory/counts", "inv-counts");
    await go(`inventory/counts/${id("count:fridge")}`, "inv-count-variance");
  }
  if (want("purchasing")) {
    await go("inventory/purchasing", "inv-pos");
    await go(`inventory/purchasing?po=${id("po:7")}`, "inv-po-marketplace");
    await go("inventory/purchasing?suggest=1", "inv-suggested");
    await go(`inventory/purchasing?po=${id("po:5")}`, "inv-po-received");
  }
  if (want("suppliers")) await go("inventory/suppliers", "inv-suppliers");
  if (want("marketplace")) {
    await go("inventory/marketplace", "inv-marketplace");
    await page.getByRole("button", { name: /قارن|Compare/ }).first().click().catch(() => {});
    await shot(page, `inv-compare-${tag}`);
  }
  if (want("reports")) {
    await go("inventory/reports", "inv-report-usage");
    await click(/^(تكلفة المبيعات|COGS)$/);
    await shot(page, `inv-report-cogs-${tag}`);
  }
  if (want("menu")) {
    await go("menu", "menu-items");
    await page.locator("li button").filter({ hasText: /كفتة مشوية|Grilled kofta/ }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    await click(/^(الأسعار|Pricing)$/).catch(() => {});
    await shot(page, `menu-item-pricing-${tag}`);
    await click(/^(الوصفة|Recipe)$/).catch(() => {});
    await shot(page, `menu-item-recipe-${tag}`);
    await go("menu", "menu-items-again");
    await click(/^(حدد الكل|Select all)$/).catch(() => {});
    await click(/غيّر أسعار|Reprice/).catch(() => {});
    await shot(page, `menu-bulk-price-${tag}`);
    await go("menu/modifiers", "menu-modifiers");
    await go("menu/engineering", "menu-engineering");
  }
  if (want("count-phone") && w === 390) {
    // kitchen staff: blind count on the phone
    await pinLogin(page, "محمد ربيع", "7000");
    await page.goto(BASE + "inventory/counts?new=1", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^(ابدأ|Start)$/ }).first().click();
    await page.waitForURL((u) => /counts\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 8000 });
    await shot(page, `inv-count-blind-phone-${tag}`);
  }
  if (want("verify") && !verified) {
    // POS: takeaway, 2 × okra tagine → send to kitchen → the okra and the lamb go down
    const kofta = id("stock:okra");
    const bread = id("stock:lamb");
    const before = [await onHand(page, kofta), await onHand(page, bread)];
    await pinLogin(page, "سارة حسني", "4000");
    await page.goto(BASE + "pos", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.getByText(/^(تيك أواي|Takeaway)$/).first().click();
    await page.waitForTimeout(400);
    const tile = page.getByRole("button", { name: /طاجن بامية|Okra & beef/ }).first();
    await tile.click();
    await page.waitForTimeout(400);
    await tile.click();
    await page.waitForTimeout(600);
    await page.keyboard.press("k");
    await page.waitForTimeout(1500);
    await shot(page, `pos-sent-okra-${tag}`);
    const after = [await onHand(page, kofta), await onHand(page, bread)];
    const ok = after[0] < before[0] && after[1] < before[1];
    console.log(`VERIFY pos sale → stock: okra ${before[0]} → ${after[0]} g, lamb ${before[1]} → ${after[1]} g: ${ok ? "OK" : "FAILED"}`);
    if (!ok) errors.push("verify: stock did not decrease after a POS sale");
    verified = true;
  }
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.log("\nERRORS:\n" + errors.join("\n"));
  process.exitCode = 1;
}

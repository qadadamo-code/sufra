#!/usr/bin/env node
/**
 * Scroll regression test: every customer page must scroll to the bottom by TOUCH (phone) and by WHEEL (desktop),
 * whatever is under the finger/pointer (rails, carousels, maps, the concierge orb).
 *
 *   npm run build && npx vite preview --port 4317 &   # or any running server
 *   node scripts/scroll-test.mjs http://127.0.0.1:4317/
 *
 * Env: CHROME=/path/to/chrome (default: the Playwright headless shell used in CI here).
 * Touch uses CDP Input.dispatchTouchEvent (synthesizeScrollGesture is a no-op in headless shell).
 * Each swipe must move the page by at least half the finger travel unless the page is already at the bottom —
 * the original bug was swipes that started on a home-page rail moving the page by 0 px.
 */
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://127.0.0.1:4317/";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
const PAGES = ["home", "explore", "explore?view=map", "r/__FIRST__", "account", "about"];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
let failures = 0;

async function firstSlug(ctx) {
  const page = await ctx.newPage();
  await page.goto(BASE + "#/explore", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a[href^="#/r/"]');
  const href = await page.getAttribute('a[href^="#/r/"]', "href");
  await page.close();
  return href.replace("#/r/", "");
}

async function run(mode) {
  const ctx = await browser.newContext(
    mode === "touch"
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1440, height: 900 } },
  );
  const slug = await firstSlug(ctx);
  for (const p of PAGES.map((x) => x.replace("__FIRST__", slug))) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(BASE + "#/" + p, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const cdp = await ctx.newCDPSession(page);
    const vw = mode === "touch" ? 390 : 1440;
    const vh = mode === "touch" ? 844 : 900;
    // fingers/pointer at a few columns so we cross rails, cards, maps and carousels
    const xs = [vw * 0.5, vw * 0.25, vw * 0.75];
    const stuck = [];
    let i = 0;
    for (; i < 400; i++) {
      const { y, max } = await page.evaluate(() => ({ y: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight }));
      if (y >= max - 2) break;
      const x = Math.round(xs[i % xs.length]);
      const y0 = Math.round(vh * 0.72);
      const travel = 360;
      if (mode === "touch") {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
        for (let k = 1; k <= 8; k++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 - (travel * k) / 8 }] });
          await page.waitForTimeout(12);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(x, y0);
        await page.mouse.wheel(0, travel);
      }
      await page.waitForTimeout(160);
      const after = await page.evaluate(() => Math.round(scrollY));
      const moved = after - y;
      const room = max - y;
      if (moved < Math.min(travel, room) * 0.5) {
        const under = await page.evaluate(([px, py]) => {
          const e = document.elementFromPoint(px, py);
          return e ? `${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).split(" ").slice(0, 3).join(".")}` : "?";
        }, [x, y0]);
        stuck.push(`y=${y} moved ${moved}px over ${under}`);
        if (stuck.length > 3) break;
      }
    }
    const end = await page.evaluate(() => ({ y: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight }));
    const ok = end.y >= end.max - 2 && stuck.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${mode.padEnd(5)}  ${p.padEnd(28)} reached ${end.y}/${end.max} in ${i} gestures${stuck.length ? "\n        stuck: " + stuck.join("\n        stuck: ") : ""}`);
    if (errors.length) {
      failures++;
      console.log("        console errors:", errors.slice(0, 3));
    }
    await page.close();
  }
  await ctx.close();
}

await run("touch");
await run("wheel");
await browser.close();
if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall pages scroll to the bottom by touch and by wheel");

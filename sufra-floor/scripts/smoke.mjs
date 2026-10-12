import { chromium } from 'playwright-core'
const OUT = process.argv[2]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--no-sandbox'] })
const errors = []
async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
  await page.goto('file://' + process.cwd() + '/dist/standalone.html')
  await page.waitForSelector('.floor-svg')
  await page.waitForTimeout(500)
  return page
}
const center = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }
}
async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
  await page.waitForTimeout(150)
}

const page = await open({ width: 1400, height: 860 })
await page.screenshot({ path: `${OUT}/1-design.png` })

// Drag T7 (bill printed) against T6 (merged T5+T6 bill): bills should merge.
const t7 = await center(page, '[data-item="T7"] .top')
const t6 = await center(page, '[data-item="T6"] .top')
const t6right = t6.b.x + t6.b.width
await drag(page, t7, { x: t7.x - (t7.b.x - t6right) + 3, y: t6.y + 2 })
await page.waitForTimeout(200)
console.log('toast after drag:', await page.locator('.toast').allInnerTexts())
console.log('group chips:', await page.locator('.group-chip text').allTextContents())
await page.screenshot({ path: `${OUT}/2-merged.png` })

// Resize T12 from its right-edge handle: seats should grow.
await page.mouse.click((await center(page, '[data-item="T12"] .top')).x, (await center(page, '[data-item="T12"] .top')).y)
await page.waitForTimeout(100)
const before = await page.locator('.seat-big strong').innerText()
const h = await center(page, '[data-handle="1,0"] .handle-dot')
await drag(page, h, { x: h.x + 70, y: h.y })
const after = await page.locator('.seat-big strong').innerText()
console.log('T12 seats', before, '->', after)
await page.screenshot({ path: `${OUT}/3-resized.png` })

// Service mode
await page.getByRole('button', { name: 'خدمة' }).click()
await page.waitForTimeout(150)
await page.screenshot({ path: `${OUT}/4-service.png` })
const t2 = await center(page, '[data-item="T2"] .top')
await page.mouse.click(t2.x, t2.y)
await page.waitForTimeout(150)
await page.screenshot({ path: `${OUT}/5-service-table.png` })

// Reservations
await page.getByRole('button', { name: 'الحجوزات' }).first().click()
await page.waitForTimeout(250)
await page.screenshot({ path: `${OUT}/6-res.png` })
await page.locator('.tl-res', { hasText: 'منى' }).first().click()
await page.waitForTimeout(200)
await page.screenshot({ path: `${OUT}/7-res-sheet.png` })
await page.keyboard.press('Escape')

// Phone
const phone = await open({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await phone.screenshot({ path: `${OUT}/8-phone.png` })
await phone.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
await phone.getByRole('button', { name: 'خدمة' }).click()
await phone.waitForTimeout(150)
await phone.screenshot({ path: `${OUT}/9-phone-dark.png` })
await phone.getByRole('button', { name: 'الحجوزات' }).first().click()
await phone.waitForTimeout(200)
await phone.screenshot({ path: `${OUT}/10-phone-res.png` })
// Two-finger pinch on a selected table (design mode) resizes it.
await phone.getByRole('button', { name: 'الصالة' }).first().click()
await phone.getByRole('button', { name: 'تصميم' }).click()
await phone.waitForTimeout(150)
const cdp = await phone.context().newCDPSession(phone)
let p8 = await center(phone, '[data-item="T8"] .top')
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) })
await touch('touchStart', [p8])
await touch('touchEnd', [])
await phone.waitForTimeout(100)
const seatsBefore = await phone.locator('.seat-big strong').innerText()
Object.assign(p8, await center(phone, '[data-item="T8"] .top'))
await touch('touchStart', [{ x: p8.x - 10, y: p8.y }])
await touch('touchStart', [{ x: p8.x - 10, y: p8.y }, { x: p8.x + 10, y: p8.y }])
for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: p8.x - 10 - i * 4, y: p8.y }, { x: p8.x + 10 + i * 4, y: p8.y }])
await touch('touchEnd', [])
await phone.waitForTimeout(150)
console.log('pinch T8 seats', seatsBefore, '->', await phone.locator('.seat-big strong').innerText())
await phone.screenshot({ path: `${OUT}/11-phone-pinch.png` })
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
console.log('phone horizontal overflow px:', overflow)
console.log('errors:', errors)
await browser.close()

// Validates data/restaurants.json against the schema the site consumes
// (the shape gen-data.mjs produces) plus the real-data provenance fields.
// Usage: node scripts/validate-data.mjs [path]   — exits 1 on any error.
import { readFileSync, existsSync } from 'node:fs'

const file = process.argv[2] ?? 'data/restaurants.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const errors = []
const err = (r, msg) => { if (errors.length < 200) errors.push(`${r?.id ?? '?'}: ${msg}`) }
const img = (k) => existsSync(`public/img/${k}.jpg`)

const AMENITIES = ['wifi', 'outlets', 'quiet', 'parking', 'outdoor', 'kids', 'wheelchair', 'shisha', 'live-music', 'prayer', 'sports-screens', 'pet-friendly', 'valet', 'nile-view', 'rooftop', 'reservations']
const MOODS = ['work', 'eat', 'drinks', 'friends', 'family', 'date', 'celebrate', 'quick', 'late', 'breakfast']
const OFFER_KINDS = ['percent', 'happy-hour', 'free-delivery', 'first-visit', 'plus', 'bogo', 'group']
const TAGS = ['veg', 'spicy', 'new', 'best', 'share']
// Greater Cairo incl. 6th of October / Sheikh Zayed / New Cairo
const BOUNDS = { minLat: 29.85, maxLat: 30.25, minLng: 30.8, maxLng: 31.7 }

const isStr = (v) => typeof v === 'string'
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isInt = (v) => Number.isInteger(v)

if (!Array.isArray(data.areas) || !data.cuisines || !Array.isArray(data.restaurants)) {
  console.error('top-level shape must be { areas[], cuisines{}, restaurants[] }')
  process.exit(1)
}
const areaIds = new Set(data.areas.map((a) => a.id))
for (const a of data.areas) if (!isStr(a.id) || !isStr(a.ar) || !isStr(a.en) || !isNum(a.lat) || !isNum(a.lng)) err(a, 'bad area')
for (const [k, c] of Object.entries(data.cuisines)) if (!isStr(c.ar) || !isStr(c.en) || !['eastern', 'western', 'asian', 'sweets', 'drinks'].includes(c.group)) err({ id: k }, 'bad cuisine')

const ids = new Set(), slugs = new Set(), itemIds = new Set()
for (const r of data.restaurants) {
  for (const k of ['id', 'slug', 'ar', 'en', 'cuisine', 'area', 'addressAr', 'addressEn', 'descAr', 'descEn', 'phone', 'instagram', 'cover'])
    if (!isStr(r[k])) err(r, `${k} must be a string`)
  for (const k of ['id', 'slug', 'ar', 'en', 'addressAr', 'addressEn']) if (isStr(r[k]) && !r[k].trim()) err(r, `${k} is empty`)
  if (ids.has(r.id)) err(r, 'duplicate id'); ids.add(r.id)
  if (slugs.has(r.slug)) err(r, 'duplicate slug'); slugs.add(r.slug)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug)) err(r, `slug not ascii-kebab: ${r.slug}`)
  if (!data.cuisines[r.cuisine]) err(r, `unknown cuisine ${r.cuisine}`)
  if (!areaIds.has(r.area)) err(r, `unknown area ${r.area}`)
  if (!isNum(r.lat) || !isNum(r.lng) || r.lat < BOUNDS.minLat || r.lat > BOUNDS.maxLat || r.lng < BOUNDS.minLng || r.lng > BOUNDS.maxLng) err(r, `lat/lng outside Greater Cairo: ${r.lat},${r.lng}`)
  if (![1, 2, 3, 4].includes(r.price)) err(r, 'price must be 1-4')
  for (const k of ['avg', 'rating', 'ratingCount', 'visits', 'since']) if (!isNum(r[k])) err(r, `${k} must be a number`)
  if (r.rating < 0 || r.rating > 5) err(r, 'rating out of range')
  // google may be null for real places (live Google Places only), else number
  if (!(r.google === null || isNum(r.google))) err(r, 'google must be number|null')
  if (!(r.googleCount === null || isNum(r.googleCount))) err(r, 'googleCount must be number|null')
  if (typeof r.isNew !== 'boolean') err(r, 'isNew must be boolean')
  if (!Array.isArray(r.hours) || r.hours.length !== 7) err(r, 'hours must have 7 entries')
  else for (const h of r.hours) {
    if (!Array.isArray(h) || h.length !== 2 || !isInt(h[0]) || !isInt(h[1])) { err(r, `bad hours entry ${JSON.stringify(h)}`); continue }
    const [o, c] = h
    if (o < 0 || o >= 1440 || c < 0 || c > 2880 || (c !== 0 && c <= o) ) err(r, `implausible hours ${o}-${c}`)
  }
  if (!Array.isArray(r.moods) || r.moods.some((m) => !MOODS.includes(m))) err(r, 'bad moods')
  if (!Array.isArray(r.amenities) || r.amenities.some((m) => !AMENITIES.includes(m))) err(r, 'bad amenities')
  if (r.delivery !== null && !(isNum(r.delivery?.fee) && isNum(r.delivery?.eta) && isNum(r.delivery?.min))) err(r, 'bad delivery')
  if (!img(r.cover)) err(r, `missing cover photo ${r.cover}`)
  if (!Array.isArray(r.gallery) || !r.gallery.length) err(r, 'empty gallery')
  else for (const g of r.gallery) if (!img(g)) err(r, `missing gallery photo ${g}`)
  if (!Array.isArray(r.offers)) err(r, 'offers must be array')
  else for (const o of r.offers) {
    if (!isStr(o.id) || !OFFER_KINDS.includes(o.kind) || !isNum(o.value) || !isStr(o.ar) || !isStr(o.en) || !isStr(o.code) || !Array.isArray(o.days) || !isNum(o.endsInDays)) err(r, `bad offer ${o.id}`)
  }
  if (!Array.isArray(r.busy) || r.busy.length !== 24 || r.busy.some((v) => !isNum(v) || v < 0 || v > 100)) err(r, 'busy must be 24 numbers 0-100')
  if (!Array.isArray(r.reviews) || r.reviews.some((v) => !isStr(v.name) || !isStr(v.text) || !isNum(v.stars) || !isNum(v.daysAgo))) err(r, 'bad reviews')
  if (!Array.isArray(r.menu) || !r.menu.length) err(r, 'empty menu')
  else for (const s of r.menu) {
    if (!isStr(s.ar) || !isStr(s.en) || !Array.isArray(s.items)) { err(r, 'bad menu section'); continue }
    for (const it of s.items) {
      if (itemIds.has(it.id)) err(r, `duplicate menu item id ${it.id}`); itemIds.add(it.id)
      if (!isStr(it.ar) || !isStr(it.en) || !isStr(it.descAr) || !isStr(it.descEn) || !isNum(it.price) || !isNum(it.kcal) || !Array.isArray(it.tags) || it.tags.some((t) => !TAGS.includes(t))) err(r, `bad menu item ${it.id}`)
      if (!img(it.img)) err(r, `missing dish photo ${it.img}`)
    }
  }
  // provenance (real-data build only)
  if (r.source) {
    if (r.source.kind !== 'osm' || !['node', 'way'].includes(r.source.type) || !isInt(r.source.id) || r.source.url !== `https://www.openstreetmap.org/${r.source.type}/${r.source.id}`) err(r, 'bad source')
    if (!['osm', 'estimated'].includes(r.hoursSource)) err(r, 'bad hoursSource')
    if (!r.sample || !['menu', 'ratings', 'offers', 'reviews', 'photos'].every((k) => r.sample[k] === true)) err(r, 'sample flags missing')
    if (typeof r.verified !== 'boolean') err(r, 'verified must be boolean')
    if (!(r.website === null || isStr(r.website))) err(r, 'website must be string|null')
  }
}

// ---- report
const rs = data.restaurants
const count = (f) => rs.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {})
const table = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k.padEnd(14)} ${v}`).join('\n')
console.log(`${file}: ${rs.length} restaurants, ${data.areas.length} areas, ${Object.keys(data.cuisines).length} cuisines`)
console.log(`per area:\n${table(count((r) => r.area))}`)
console.log(`per cuisine:\n${table(count((r) => r.cuisine))}`)
if (rs.some((r) => r.source)) {
  const n = (f) => `${rs.filter(f).length} (${Math.round((rs.filter(f).length / rs.length) * 100)}%)`
  console.log('real-data coverage:')
  console.log(`  real opening hours  ${n((r) => r.hoursSource === 'osm')}`)
  console.log(`  real phone          ${n((r) => r.phone)}`)
  console.log(`  real website        ${n((r) => r.website)}`)
  console.log(`  real instagram      ${n((r) => r.instagram)}`)
  console.log(`  cuisine from OSM    ${n((r) => r.cuisineSource === 'osm')}`)
  console.log(`  address from addr:* ${n((r) => r.addressSource === 'osm')}  (nearest street ${n((r) => r.addressSource === 'nearest-street')})`)
  console.log(`  ar ≠ en name        ${n((r) => r.ar !== r.en)}`)
  console.log(`  verified (≥3 real)  ${n((r) => r.verified)}`)
  console.log(`  brand               ${n((r) => r.brand)}`)
  console.log(`  real amenity tags   ${n((r) => r.amenitiesReal?.length)}`)
}
if (errors.length) {
  console.error(`\n${errors.length} error(s):\n${errors.join('\n')}`)
  process.exit(1)
}
console.log('\nOK: schema valid')

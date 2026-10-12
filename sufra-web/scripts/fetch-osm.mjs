// Fetches real food & drink places in Greater Cairo from OpenStreetMap and writes
// data/osm-places.json (one compact record per named place, tags kept verbatim).
//
// Source: the OSM editing API /api/0.6/map (Overpass is not reachable from the
// build machine). Each area is tiled into <= 0.02° x 0.02° boxes; a tile that
// exceeds the API node limit is split into four. Raw responses are cached
// (gzipped) under OSM_CACHE so reruns are offline. Requests are rate limited
// to 1/second with a descriptive User-Agent, per the OSM API usage policy.
//
// Data © OpenStreetMap contributors, ODbL 1.0 — see scripts/README.md.
//
// Usage: node scripts/fetch-osm.mjs [--only=zamalek,maadi] [--refresh]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { join } from 'node:path'

const UA = 'SufraDemo/0.1 (qadadamo@gmail.com)'
const API = 'https://api.openstreetmap.org/api/0.6'
const CACHE = process.env.OSM_CACHE ?? '/tmp/claude-0/-home-user/171130dc-9901-54a1-b8fa-a9999058346d/scratchpad/osm-cache'
const TILE = 0.02
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))

// [id, minLon, minLat, maxLon, maxLat]. The first 12 are the site's areas;
// the rest are extra well-known food districts (see EXTRA_AREAS in build-real-data.mjs).
export const BOXES = [
  ['zamalek', 31.205, 30.04, 31.235, 30.075],
  ['garden-city', 31.225, 30.026, 31.238, 30.042],
  ['downtown', 31.235, 30.04, 31.255, 30.06],
  ['dokki', 31.195, 30.028, 31.22, 30.048],
  ['mohandessin', 31.18, 30.045, 31.21, 30.07],
  ['maadi', 31.24, 29.945, 31.28, 29.975],
  ['heliopolis', 31.305, 30.08, 31.35, 30.11],
  ['nasr-city', 31.3, 30.04, 31.36, 30.075],
  ['new-cairo', 31.40, 29.995, 31.50, 30.04],
  ['rehab', 31.475, 30.05, 31.505, 30.07],
  ['zayed', 30.95, 30.01, 31.01, 30.07],
  ['october', 30.90, 29.94, 30.98, 30.0],
  ['manial', 31.218, 30.01, 31.232, 30.03],
  ['mokattam', 31.29, 30.005, 31.32, 30.03],
  ['sheraton', 31.36, 30.09, 31.39, 30.11],
  // fringes of the sparse western/eastern suburbs (labelled by nearest area centre)
  ['new-cairo-n', 31.40, 30.04, 31.475, 30.06],
  ['new-cairo-w', 31.38, 29.995, 31.40, 30.06],
  ['zayed-n', 30.95, 30.07, 31.01, 30.09],
  ['october-n', 30.90, 30.0, 30.95, 30.01],
]

const FOOD_AMENITY = new Set(['restaurant', 'cafe', 'fast_food', 'ice_cream'])
const FOOD_SHOP = new Set(['bakery', 'pastry'])
const KEEP = /^(name|name:ar|name:en|cuisine|opening_hours|phone|contact:phone|contact:mobile|phone:mobile|website|contact:website|contact:instagram|contact:facebook|addr:.*|outdoor_seating|internet_access|wheelchair|delivery|takeaway|smoking|brand|brand:ar|brand:en|diet:.*|amenity|shop|check_date|disused|was:.*|operator)$/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastReq = 0
let requests = 0

async function getMap(b) {
  const key = b.map((x) => x.toFixed(4)).join('_')
  const file = join(CACHE, `map_${key}.json.gz`)
  if (!args.refresh && existsSync(file)) return { status: 200, data: JSON.parse(gunzipSync(readFileSync(file))) }
  const wait = lastReq + 1100 - Date.now()
  if (wait > 0) await sleep(wait)
  for (let attempt = 0; attempt < 4; attempt++) {
    lastReq = Date.now()
    requests++
    const res = await fetch(`${API}/map.json?bbox=${b.join(',')}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (res.status === 400 || res.status === 509) {
      const msg = await res.text()
      if (/too many nodes|maximum/i.test(msg) || res.status === 400) return { status: 400, msg }
    }
    if (res.status === 429 || res.status >= 500) {
      const back = 5000 * (attempt + 1)
      console.warn(`  HTTP ${res.status}, backing off ${back / 1000}s`)
      await sleep(back)
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${b}`)
    const text = await res.text()
    writeFileSync(file, gzipSync(text))
    return { status: 200, data: JSON.parse(text) }
  }
  throw new Error(`gave up on ${b}`)
}

function tiles([minLon, minLat, maxLon, maxLat]) {
  const out = []
  for (let x = minLon; x < maxLon - 1e-9; x += TILE)
    for (let y = minLat; y < maxLat - 1e-9; y += TILE)
      out.push([x, y, Math.min(x + TILE, maxLon), Math.min(y + TILE, maxLat)].map((v) => +v.toFixed(4)))
  return out
}

const isFood = (t) => (FOOD_AMENITY.has(t.amenity) || FOOD_SHOP.has(t.shop))

/** Collect POIs + named streets from one map response. */
function extract(data, box, places, streets) {
  const nodes = new Map()
  for (const e of data.elements) if (e.type === 'node') nodes.set(e.id, e)
  const [minLon, minLat, maxLon, maxLat] = box
  const inBox = (lat, lng) => lat >= minLat && lat < maxLat && lng >= minLon && lng < maxLon
  for (const e of data.elements) {
    const t = e.tags
    if (!t) continue
    if (e.type === 'way' && t.highway && (t.name || t['name:ar'] || t['name:en'])) {
      // sample every way node as a street point (for nearest-street addresses)
      for (const id of e.nodes ?? []) {
        const n = nodes.get(id)
        if (n && inBox(n.lat, n.lon)) streets.set(`${e.id}:${id}`, { lat: n.lat, lng: n.lon, name: t.name ?? null, ar: t['name:ar'] ?? null, en: t['name:en'] ?? null })
      }
    }
    if (!isFood(t)) continue
    if (!(t.name || t['name:ar'] || t['name:en'] || t.brand)) continue
    let lat, lng
    if (e.type === 'node') [lat, lng] = [e.lat, e.lon]
    else if (e.type === 'way') {
      const pts = (e.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean)
      if (!pts.length) continue
      const uniq = pts.length > 1 && pts[0].id === pts.at(-1).id ? pts.slice(0, -1) : pts
      lat = uniq.reduce((s, p) => s + p.lat, 0) / uniq.length
      lng = uniq.reduce((s, p) => s + p.lon, 0) / uniq.length
    } else continue
    if (!inBox(lat, lng)) continue // ways crossing tiles: keep in the tile holding the centroid
    const tags = Object.fromEntries(Object.entries(t).filter(([k]) => KEEP.test(k)))
    places.set(`${e.type}/${e.id}`, { type: e.type, id: e.id, lat: +lat.toFixed(6), lng: +lng.toFixed(6), version: e.version, timestamp: e.timestamp, tags })
  }
}

async function crawl(box, places, streets, depth = 0) {
  const r = await getMap(box)
  if (r.status === 400) {
    if (depth > 3) { console.warn(`  skipping dense tile ${box}`); return }
    const [a, b, c, d] = box
    const mx = +((a + c) / 2).toFixed(4), my = +((b + d) / 2).toFixed(4)
    for (const q of [[a, b, mx, my], [mx, b, c, my], [a, my, mx, d], [mx, my, c, d]]) await crawl(q, places, streets, depth + 1)
    return
  }
  extract(r.data, box, places, streets)
}

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const only = typeof args.only === 'string' ? new Set(args.only.split(',')) : null
  const places = new Map()
  const streets = new Map()
  const perBox = {}
  for (const [id, ...bbox] of BOXES) {
    if (only && !only.has(id)) continue
    const before = places.size
    const ts = tiles(bbox)
    for (const t of ts) await crawl(t, places, streets)
    perBox[id] = places.size - before
    console.log(`${id.padEnd(12)} ${ts.length} tiles, +${perBox[id]} places (total ${places.size}, ${requests} HTTP requests so far)`)
  }
  // Thin the street points to ~1 per 50 m cell to keep the file small.
  const cells = new Map()
  for (const s of streets.values()) {
    const k = `${Math.round(s.lat * 2000)}:${Math.round(s.lng * 2000)}`
    if (!cells.has(k)) cells.set(k, s)
  }
  mkdirSync('data', { recursive: true })
  writeFileSync(
    'data/osm-places.json',
    JSON.stringify({
      attribution: '© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright',
      fetchedAt: new Date().toISOString(),
      source: `${API}/map`,
      boxes: BOXES,
      places: [...places.values()].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id),
      streets: [...cells.values()].map((s) => [+s.lat.toFixed(5), +s.lng.toFixed(5), s.name, s.ar, s.en]),
    }),
  )
  console.log(`wrote data/osm-places.json: ${places.size} places, ${cells.size} street points, ${requests} HTTP requests`)
}

main().catch((e) => { console.error(e); process.exit(1) })

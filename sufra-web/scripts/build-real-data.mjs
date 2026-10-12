// Builds data/restaurants.json from REAL places in data/osm-places.json
// (produced by fetch-osm.mjs). Real: names, location, area, address, cuisine,
// opening hours, phone, website, instagram, brand and the amenities OSM tags.
// Everything OSM does not hold (price, ratings, menus, photos, offers, reviews,
// busy hours, delivery terms, moods...) is deterministic SAMPLE data made with
// the gen-data.mjs helpers and flagged in `sample`.
//
// Restaurant data © OpenStreetMap contributors, ODbL 1.0. The output is a
// derived database: keep the attribution and share it under ODbL (README.md).
//
// Usage: node scripts/build-real-data.mjs [--max=360]
import { readFileSync, writeFileSync } from 'node:fs'
import {
  AREAS, CUISINES, MOODS_BY_CUISINE, AMENITY_ODDS, REVIEW_POOL, REVIEWERS, HOURS, DESC,
  VENUE_VARIANTS, GENERIC_VENUE, SCENIC, EXTERIOR,
  setSeed, rnd, pick, between, int, chance, shuffle, round5, slugify, popularTimes, makeMenu, makeOffer,
} from './gen-data.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const MAX = Number(args.max ?? 360)
const PER_AREA_CAP = Number(args.perArea ?? 40)
const PER_NAME_CAP = 3 // branches of one chain kept overall

// Extra food districts fetched by fetch-osm.mjs (beyond the original 12).
const EXTRA_AREAS = [
  { id: 'manial', ar: 'المنيل', en: 'El Manial', lat: 30.0205, lng: 31.2264 },
  { id: 'mokattam', ar: 'المقطم', en: 'Mokattam', lat: 30.0175, lng: 31.3045 },
  { id: 'sheraton', ar: 'مساكن شيراتون', en: 'Sheraton Heliopolis', lat: 30.1005, lng: 31.3745 },
]
const ALL_AREAS = [...AREAS.map(({ streets, ...a }) => a), ...EXTRA_AREAS]

// ---------------------------------------------------------------- helpers
const AR = /[؀-ۿ]/
const LAT = /[A-Za-z]/
const stripPhones = (s) => s.replace(/\+?\d[\d\s-]{6,}\d/g, ' ')
const clean = (s) => (s ?? '').replace(/\s*;\s*/g, ' · ').replace(/\s+/g, ' ').trim()
const toRad = (d) => (d * Math.PI) / 180
function km(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
function hash(str) {
  let h = 2166136261
  for (const c of str) h = Math.imul(h ^ c.codePointAt(0), 16777619)
  return h >>> 0
}
const normName = (s) => clean(s).toLowerCase()
  .replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/^(the|مطعم|كافيه|كافية|كافي|cafe|café|restaurant)\s+/, '')
  .replace(/\b(restaurant|cafe|café|coffee|branch)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, '')

// Well-known brands only: Latin ↔ Arabic spellings used on their own Egyptian signage.
const BRANDS = [
  ['KFC', 'كنتاكي'], ["McDonald's", 'ماكدونالدز'], ['Starbucks', 'ستاربكس'], ['Costa Coffee', 'كوستا كافيه'],
  ['Cilantro', 'سيلانترو'], ['Pizza Hut', 'بيتزا هت'], ["Hardee's", 'هارديز'], ['Burger King', 'برجر كينج'],
  ["Papa John's", 'بابا جونز'], ["Domino's Pizza", 'دومينوز بيتزا'], ['Buffalo Burger', 'بافلو برجر'],
  ['Cook Door', 'كوك دور'], ["Mo'men", 'مؤمن'], ['Abou Tarek', 'أبو طارق'], ['Gad', 'جاد'], ['Felfela', 'فلفلة'],
  ['Zooba', 'زووبا'], ['Koshary El Tahrir', 'كشري التحرير'], ['Dunkin', 'دانكن'], ['Cinnabon', 'سينابون'],
  ['Cinnabon', 'سينابون'], ['Subway', 'صب واي'], ['Little Caesars', 'ليتل سيزرز'], ['Chili\'s', 'تشيليز'],
  ['TBS', 'تي بي إس'], ['Tseppas', 'تسيباس'], ['Mandarine Koueider', 'ماندرين قويدر'], ['El Abd', 'العبد'],
  ['Mince', 'مينس'], ['Willy\'s Kitchen', 'ويليز كيتشن'], ['Bazooka', 'بازوكا'], ['Gad', 'جاد'],
  ['Tabali', 'طبالي'], ['Sale Sucre', 'سالي سكر'], ['Caribou Coffee', 'كاريبو كوفي'], ['Tim Hortons', 'تيم هورتنز'],
  ['Crave', 'كريف'], ['Sushi Bay', 'سوشي باي'], ['Hamza', 'حمزة'], ['On the Run', 'أون ذا رن'],
]
const brandByLatin = new Map(BRANDS.map(([en, ar]) => [normName(en), { en, ar }]))
const brandByArabic = new Map(BRANDS.map(([en, ar]) => [normName(ar), { en, ar }]))

/** Pick ar/en names without inventing translations. */
function names(t) {
  const n = clean(t.name), nAr = clean(t['name:ar']), nEn = clean(t['name:en'])
  let ar = nAr || (AR.test(n) ? n : '')
  let en = nEn || (LAT.test(n) && !AR.test(n) ? n : '')
  // "مطعم كايرو كيتشن Cairo Kitchen" → split a bilingual name tag
  if (n && AR.test(n) && LAT.test(n)) {
    const arPart = clean(n.replace(/[A-Za-z0-9'’&.\-]+/g, ' ').replace(/[|/\-–]+/g, ' '))
    const enPart = clean(n.replace(/[؀-ۿ]+/g, ' ').replace(/^[\s|/\-–]+|[\s|/\-–]+$/g, ''))
    if (!ar && arPart.length > 1) ar = arPart
    if (!en && enPart.length > 1 && LAT.test(enPart)) en = enPart
  }
  // well-known brands: transliterate the missing language only when certain
  const br = clean(t.brand)
  if (!ar) ar = clean(t['brand:ar']) || brandByLatin.get(normName(en || br))?.ar || ''
  if (!en) en = clean(t['brand:en']) || brandByArabic.get(normName(ar))?.en || ''
  // otherwise keep the original in both languages
  ar ||= en || n || br
  en ||= ar || n || br
  return { ar, en }
}

// ---------------------------------------------------------------- cuisine
const CUISINE_MAP = {
  egyptian: 'egyptian', koshry: 'egyptian', african: 'egyptian', sudanese: 'egyptian', 'وجبات_سريعه': 'burger', swiss: 'italian', pretzel: 'bakery', koshari: 'egyptian', koshary: 'egyptian', falafel: 'egyptian', foul: 'egyptian', ful: 'egyptian', feteer: 'egyptian', regional: 'egyptian', local: 'egyptian', arab: 'egyptian', arabic: 'egyptian', oriental: 'egyptian', 'middle_eastern': 'levant', fatayer: 'egyptian', liver: 'egyptian', hawawshi: 'egyptian', breakfast: 'egyptian', sandwich: 'egyptian', fuul: 'egyptian',
  lebanese: 'levant', syrian: 'levant', levantine: 'levant', shawarma: 'levant', shawerma: 'levant', palestinian: 'levant', jordanian: 'levant', turkish: 'grill', manakish: 'levant', mediterranean: 'levant', greek: 'levant',
  saudi: 'gulf', yemeni: 'gulf', mandi: 'gulf', gulf: 'gulf', kuwaiti: 'gulf', emirati: 'gulf',
  italian: 'italian', pizza: 'italian', pasta: 'italian', french: 'italian', european: 'italian', international: 'italian', steak_house: 'grill',
  burger: 'burger', american: 'burger', chicken: 'burger', fried_chicken: 'burger', hot_dog: 'burger', fast_food: 'burger', wings: 'burger', 'tex-mex': 'mexican',
  sushi: 'asian', japanese: 'asian', chinese: 'asian', thai: 'asian', asian: 'asian', korean: 'asian', vietnamese: 'asian', ramen: 'asian', noodle: 'asian', noodles: 'asian', 'dim_sum': 'asian',
  indian: 'indian', pakistani: 'indian', curry: 'indian',
  mexican: 'mexican', burrito: 'mexican', tacos: 'mexican', latin_american: 'mexican',
  kebab: 'grill', grill: 'grill', barbecue: 'grill', bbq: 'grill', meat: 'grill', kofta: 'grill',
  seafood: 'seafood', fish: 'seafood', fish_and_chips: 'seafood',
  coffee_shop: 'cafe', coffee: 'cafe', cafe: 'cafe', tea: 'cafe', juice: 'healthy', bubble_tea: 'cafe', breakfast_cafe: 'cafe',
  ice_cream: 'dessert', dessert: 'dessert', desserts: 'dessert', cake: 'dessert', 'جميع_انواع_الجاتوه_السريع_والترت': 'dessert', gateau: 'dessert', crepe: 'dessert', waffle: 'dessert', donut: 'dessert', chocolate: 'dessert', frozen_yogurt: 'dessert', pastry: 'bakery', oriental_sweets: 'dessert', sweets: 'dessert', konafa: 'dessert', kunafa: 'dessert',
  bakery: 'bakery', bagel: 'bakery', bread: 'bakery', sandwich_bakery: 'bakery',
  healthy: 'healthy', salad: 'healthy', vegan: 'healthy', vegetarian: 'healthy', organic: 'healthy', smoothie: 'healthy',
  shisha: 'shisha', hookah: 'shisha',
}
const NAME_RULES = [
  [/كشر[يى]|koshar|koshary|كبده|كبدة|فول|طعمي|فلافل|falafel|ful\b|حواوشي|فطاطري|فطير|feteer|mahshi|محشي/i, 'egyptian'],
  [/شاورم|شاورمه|shawarm|shawerm|سوري|شامي|لبنان|lebnan|leban|beirut|بيروت|damas|دمشق|halab|حلب/i, 'levant'],
  [/مندي|كبسة|mandi|kabsa|حضرموت|hadramout|يمني|اليمن|yemen/i, 'gulf'],
  [/مشوي|حاتي|كباب|كفتة|kebab|kabab|grill|kofta|hati|جريل/i, 'grill'],
  [/pizza|بيتزا|pasta|باستا|ital|trattoria|osteria|pizzeria/i, 'italian'],
  [/burger|برجر|برغر|fried chicken|chicken|تشيكن|فرايد|wings|hot ?dog|kfc|kentucky|كنتاكي|فراخ|ferakh|hardee|mcdonald|cook ?door|mo'?men/i, 'burger'],
  [/sushi|سوشي|ramen|wok|asian|chinese|صيني|thai|japan|noodle|نودلز|korean|كوري|sabai|بانكوك|bangkok/i, 'asian'],
  [/india|هندي|curry|كاري|tandoor|biryani|برياني/i, 'indian'],
  [/mexic|taco|تاكو|burrito|بوريتو/i, 'mexican'],
  [/fish|سمك|أسماك|اسماك|seafood|بحري|جمبري|shrimp|crab|كابوريا/i, 'seafood'],
  [/ice ?cream|gelato|جيلاتو|آيس|ايس كريم|حلواني|حلويات|sweets|dessert|كنافة|كنافه|waffle|وافل|crepe|كريب|cake|كيك|donut|دونات|chocolat|شوكولا|بسبوسة|sobhy|el abd|العبد|koueider|قويدر/i, 'dessert'],
  [/bakery|bakehouse|boulangerie|patisserie|pâtisserie|مخبز|فرن|bread|croissant|كرواسون|bagel/i, 'bakery'],
  [/salad|سلطة|healthy|صحي|juice|عصير|smoothie|vegan|green|organic/i, 'healthy'],
  [/coffee|كافيه|كافي|cafe|café|espresso|roast|brew|starbucks|costa|cilantro|tea\b/i, 'cafe'],
  [/قهوة|قهوه|مقهى|مقهي|ahwa|shisha|شيشة|شيشه|hookah|نرجيلة/i, 'shisha'],
]
function cuisineOf(t, nm) {
  for (const raw of (t.cuisine ?? '').toLowerCase().split(/[;,]/).map((s) => s.trim().replace(/\s+/g, '_'))) {
    if (raw && CUISINE_MAP[raw]) return { cuisine: CUISINE_MAP[raw], from: 'osm' }
  }
  if (t.amenity === 'ice_cream') return { cuisine: 'dessert', from: 'osm' }
  if (t.shop === 'pastry') return { cuisine: 'dessert', from: 'osm' }
  if (t.shop === 'bakery') return { cuisine: 'bakery', from: 'osm' }
  const text = `${nm.en} ${nm.ar} ${t.brand ?? ''}`
  for (const [re, c] of NAME_RULES) if (re.test(text)) {
    // an "ahwa" tagged restaurant is still a restaurant; keep shisha only for cafés
    if (c === 'shisha' && t.amenity !== 'cafe') continue
    return { cuisine: c, from: 'name' }
  }
  if (t.amenity === 'cafe') return { cuisine: 'cafe', from: 'type' }
  return { cuisine: 'egyptian', from: 'default' }
}

// ---------------------------------------------------------------- opening_hours
const DAYS = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 }
const t2m = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
function parseDays(sel) {
  const out = new Set()
  for (const part of sel.split(',')) {
    const p = part.trim()
    if (p === 'PH' || p === 'SH') continue
    const m = p.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?$/)
    if (!m) return null
    const a = DAYS[m[1]], b = m[2] ? DAYS[m[2]] : a
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break }
  }
  return out
}
function parseTimes(sel) {
  let open = Infinity, close = -Infinity
  for (const part of sel.split(',')) {
    const m = part.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\+?$/)
    if (!m) return null
    const o = t2m(m[1])
    let c = t2m(m[2])
    if (c <= o) c += 1440
    if (o >= 1440 || c > 2880) return null
    open = Math.min(open, o)
    close = Math.max(close, c)
  }
  return open < close ? [open, close] : null
}
/** Lenient fallback for the frequent non-standard "11:00Am - 3:00Am" / "9am:2am" values (every day). */
function parseAmPm(raw) {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2})?)?\s*([ap])\.?m\.?\s*[-_:–to ]+\s*(\d{1,2})(?::(\d{2})?)?\s*([ap])\.?m?\.?[,.]?$/i)
  if (!m) return null
  const toMin = (h, mm, ap) => ((+h % 12) + (ap.toLowerCase() === 'p' ? 12 : 0)) * 60 + (+mm || 0)
  let o = toMin(m[1], m[2], m[3])
  // "12:00Am - 3:00Am" is colloquial for noon → 3 AM
  if (o === 0 && toMin(m[4], m[5], m[6]) <= 360) o = 720
  let c = toMin(m[4], m[5], m[6])
  if (c <= o) c += 1440
  return Array.from({ length: 7 }, () => [o, c])
}

/**
 * Parses the common OSM opening_hours forms into hours[7] (0 = Sunday) or null.
 * Supports 24/7, day lists/ranges (incl. wrap-around Sa-Th), several time
 * spans per day (merged to first-open..last-close), close after midnight,
 * `off`/`closed`, and rules separated by ";" or ", " (later rules win).
 */
export function parseOpeningHours(raw) {
  if (!raw) return null
  const ampm = parseAmPm(raw)
  if (ampm) return ampm
  let s = raw.trim().replace(/\s+/g, ' ').replace(/–/g, '-').replace(/\b24:00\b/g, '24:00')
  if (s === '24/7' || /^Mo-Su 00:00-24:00$/.test(s)) return Array.from({ length: 7 }, () => [0, 1440])
  const hours = Array.from({ length: 7 }, () => null)
  // split into rules; a ", " followed by a weekday starts a new rule too
  const rules = s.split(/\s*;\s*|(?<=\d|off|closed),\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/).filter(Boolean)
  let any = false
  for (let r of rules) {
    r = r.trim().replace(/"[^"]*"/g, '').trim()
    if (!r) continue
    if (r === '24/7') { for (let d = 0; d < 7; d++) hours[d] = [0, 1440]; any = true; continue }
    const m = r.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)?\s*(.*)$/)
    if (!m) return null
    const daySel = m[1]?.trim().replace(/,$/, '')
    const rest = (m[2] ?? '').trim()
    const days = daySel ? parseDays(daySel) : new Set([0, 1, 2, 3, 4, 5, 6])
    if (!days) return null
    if (daySel && days.size === 0) continue // PH-only rule
    if (/^(off|closed)$/i.test(rest)) { for (const d of days) hours[d] = [0, 0]; any = true; continue }
    const times = rest === '' || rest === 'open' ? null : parseTimes(rest)
    if (!times) return null
    for (const d of days) hours[d] = times
    any = true
  }
  if (!any) return null
  return hours.map((h) => h ?? [0, 0])
}

// ---------------------------------------------------------------- misc tag helpers
const first = (v) => clean((v ?? '').split(';')[0])
function phoneOf(t) {
  const p = first(t.phone || t['contact:phone'] || t['contact:mobile'] || t['phone:mobile']).split(/[,/]|\s(?=\+)/)[0]
  return p.replace(/[^\d+ ]/g, '').replace(/\s+/g, ' ').trim()
}
function websiteOf(t) {
  let w = first(t.website || t['contact:website'])
  if (!w) return null
  if (!/^https?:\/\//i.test(w)) w = `https://${w}`
  return w
}
function instagramOf(t) {
  const v = first(t['contact:instagram'])
  if (!v) return ''
  const m = v.match(/instagram\.com\/([A-Za-z0-9_.]+)/i) || v.match(/^@?([A-Za-z0-9_.]+)$/)
  return m ? `@${m[1].replace(/\.$/, '')}` : ''
}
const YES = (v) => v && /^(yes|wlan|wifi|free|customers|only|designated|limited)$/i.test(v.split(';')[0])
const NO = (v) => v && /^no$/i.test(v)

// nearest named street (from the street points fetch-osm.mjs collected)
function streetIndex(points) {
  const grid = new Map()
  const key = (lat, lng) => `${Math.floor(lat * 500)}:${Math.floor(lng * 500)}`
  for (const p of points) {
    const k = key(p[0], p[1])
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(p)
  }
  return (lat, lng, maxKm = 0.08) => {
    let best = null, bd = maxKm
    const cy = Math.floor(lat * 500), cx = Math.floor(lng * 500)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      for (const p of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
        const d = km({ lat, lng }, { lat: p[0], lng: p[1] })
        if (d < bd) { bd = d; best = p }
      }
    if (!best) return null
    const [, , name, ar, en] = best
    return { ar: ar || (AR.test(name ?? '') ? name : null), en: en || (name && !AR.test(name) ? name : null), any: name || ar || en }
  }
}

function addressOf(t, area, near) {
  const hn = clean(t['addr:housenumber']).slice(0, 12)
  const [st, stAr, stEn] = ['addr:street', 'addr:street:ar', 'addr:street:en'].map((k) => clean(stripPhones(t[k] ?? '')))
  let ar = stAr || (AR.test(st) ? st : '')
  let en = stEn || (st && !AR.test(st) ? st : '')
  let source = st || stAr || stEn ? 'osm' : null
  if (source && (!ar || !en)) {
    // the other language only when the nearest mapped street carries the same name
    const s = near(+t.__lat, +t.__lng, 0.15)
    if (s && [s.any, s.ar, s.en].includes(ar || en)) { ar ||= s.ar ?? ''; en ||= s.en ?? '' }
  }
  const full = clean(t['addr:full'])
  if (!source && full) { ar = AR.test(full) ? full : ''; en = !AR.test(full) ? full : ''; source = 'osm' }
  if (!source) {
    const s = near(+t.__lat, +t.__lng)
    if (s) { ar = s.ar ?? ''; en = s.en ?? ''; if (!ar && !en) ar = en = s.any; source = 'nearest-street' }
  }
  ar ||= en
  en ||= ar
  if (!source) return { addressAr: area.ar, addressEn: area.en, addressSource: 'area' }
  const numAr = hn ? `${hn} ` : '', numEn = hn ? `${hn} ` : ''
  return {
    addressAr: `${numAr}${ar}، ${area.ar}`,
    addressEn: `${numEn}${en}, ${area.en}`,
    addressSource: source,
  }
}

function asciiSlug(s) {
  const map = { ا: 'a', أ: 'a', إ: 'e', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a', و: 'w', ي: 'y', ى: 'a', ئ: 'e', ء: '', ؤ: 'o' }
  const latin = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[؀-ۿ]/g, (c) => map[c] ?? '')
  return slugify(latin)
}

// ---------------------------------------------------------------- price levels (sample)
const LEVELS = { cafe: [2, 3], egyptian: [1, 2], levant: [2, 3], grill: [2, 3], italian: [2, 4], burger: [2, 2], asian: [3, 4], seafood: [2, 4], dessert: [1, 2], bakery: [1, 2], healthy: [2, 3], gulf: [2, 3], shisha: [1, 2], indian: [2, 3], mexican: [2, 3] }

// ---------------------------------------------------------------- main
const src = JSON.parse(readFileSync('data/osm-places.json', 'utf8'))
const near = streetIndex(src.streets)
const dropped = { nameless: 0, closed: 0, nonFood: 0, outside: 0, duplicate: 0, chainCap: 0, areaCap: 0, total: 0 }

const CLOSED = /\b(closed|disused|abandoned|permanently)\b|مغلق|مقفول|اتقفل/i
const NON_FOOD = /^(food court|قاعة الطعام)$|playstation|بلاي ستيشن|\b(supermarket|market|pharmacy|kiosk|grocery|butcher|hotel|club|bank|atm|school|mosque|church|office|company)\b|سوبر ?ماركت|صيدلية|بقالة|جزارة|كشك/i

let cands = []
for (const p of src.places) {
  const t = p.tags
  if (!(t.name || t['name:ar'] || t['name:en'] || t.brand)) { dropped.nameless++; continue }
  if (Object.keys(t).some((k) => /^(disused|was|abandoned|demolished|closed)(:|$)/.test(k)) || CLOSED.test(`${t.name ?? ''} ${t['name:en'] ?? ''}`) || t.opening_hours === 'closed' || t.opening_hours === 'off') { dropped.closed++; continue }
  const nm = names(t)
  if (NON_FOOD.test(`${nm.en} ${nm.ar}`) && !t.cuisine) { dropped.nonFood++; continue }
  if (nm.ar.length < 2 || /^\d+$/.test(nm.en)) { dropped.nameless++; continue }
  const pos = { lat: p.lat, lng: p.lng }
  // area = nearest centre among the fetch boxes containing the point (so e.g. Cairo
  // Festival City stays in New Cairo although Nasr City's centre is closer), else nearest overall
  const inside = new Set(src.boxes.filter(([, a, b, c, d]) => p.lng >= a && p.lng <= c && p.lat >= b && p.lat <= d).map(([id]) => id.replace(/-[nsew]$/, '')))
  let area = ALL_AREAS[0], best = Infinity
  for (const a of ALL_AREAS) { const d = km(pos, a); if ((!inside.size || inside.has(a.id)) && d < best) { best = d; area = a } }
  if (best > 9) { dropped.outside++; continue }
  const hasAddr = Boolean(t['addr:street'] || t['addr:full'] || t['addr:housenumber'])
  const phone = phoneOf(t), website = websiteOf(t)
  const realCount = [t.cuisine, t.opening_hours, phone, website, hasAddr].filter(Boolean).length
  const score = realCount * 2 + (t['name:ar'] && t['name:en'] ? 1.5 : 0) + (t.brand ? 0.5 : 0) + (t.amenity === 'restaurant' || t.amenity === 'cafe' ? 0.5 : 0) + Object.keys(t).length * 0.05
  cands.push({ p, t, nm, area, dist: best, phone, website, hasAddr, realCount, score, key: normName(nm.en) || normName(nm.ar), keyAr: normName(nm.ar) })
}

// duplicates: same name within 150 m (node + building way, or double-mapped)
cands.sort((a, b) => b.score - a.score)
const kept = []
for (const c of cands) {
  if (kept.some((k) => (k.key === c.key || k.keyAr === c.keyAr) && km(k.p, c.p) < 0.15)) { dropped.duplicate++; continue }
  kept.push(c)
}
cands = kept

// quality-first selection with per-area and per-chain caps
const perArea = {}, perName = {}, perNameArea = {}
const chosen = []
for (const c of cands) {
  if (chosen.length >= MAX) break
  const nk = c.key, nak = `${nk}|${c.area.id}`
  if ((perName[nk] ?? 0) >= PER_NAME_CAP || perNameArea[nak]) { dropped.chainCap++; continue }
  if ((perArea[c.area.id] ?? 0) >= PER_AREA_CAP) { dropped.areaCap++; continue }
  perName[nk] = (perName[nk] ?? 0) + 1
  perNameArea[nak] = 1
  perArea[c.area.id] = (perArea[c.area.id] ?? 0) + 1
  chosen.push(c)
}
dropped.total = src.places.length - chosen.length
const candPerArea = cands.reduce((m, c) => ((m[c.area.id] = (m[c.area.id] ?? 0) + 1), m), {})

// ---------------------------------------------------------------- records
const slugs = new Set()
const restaurants = chosen.map((c) => {
  const { p, t, nm, area } = c
  const id = `osm-${p.type[0]}${p.id}`
  setSeed(hash(id)) // per-place deterministic sample data
  const { cuisine, from: cuisineFrom } = cuisineOf(t, nm)

  // hours
  const parsed = parseOpeningHours(t.opening_hours)
  let hours = parsed
  if (!hours) {
    const [open, close] = HOURS[cuisine] ?? HOURS._
    const o = open + pick([0, 0, 0, 60, -60]), cl = close + pick([0, 0, 60, -60])
    hours = Array.from({ length: 7 }, (_, d) => (d === 5 && chance(0.25) ? [Math.max(o, 13 * 60), cl] : [o, cl + (d === 4 || d === 5 ? 60 : 0)]))
  }

  // amenities: real ones from OSM tags, the rest sampled (and never contradicting an explicit "no")
  const real = []
  if (YES(t.internet_access)) real.push('wifi')
  if (YES(t.outdoor_seating)) real.push('outdoor')
  if (/^(yes|limited)$/.test(t.wheelchair ?? '')) real.push('wheelchair')
  if (/shisha|hookah|narghile/i.test(t.smoking ?? '') || /yes/.test(t.shisha ?? '')) real.push('shisha')
  const denied = new Set([NO(t.internet_access) && 'wifi', NO(t.outdoor_seating) && 'outdoor', NO(t.wheelchair) && 'wheelchair', NO(t.smoking) && 'shisha'].filter(Boolean))
  const amen = new Set(real)
  for (const [k, odds] of Object.entries(AMENITY_ODDS)) {
    const hit = chance(odds[cuisine] ?? odds._)
    if (hit && !denied.has(k) && !['outdoor', 'wheelchair'].includes(k)) amen.add(k)
  }
  const riverside = ['zamalek', 'garden-city', 'maadi', 'manial'].includes(area.id)
  if (riverside && chance(0.15)) amen.add('nile-view')
  if (chance(0.08)) amen.add('rooftop')
  if (!['shisha', 'dessert', 'bakery'].includes(cuisine) && t.amenity !== 'fast_food' && chance(0.85)) amen.add('reservations')
  const amenities = [...amen]

  // delivery: OSM yes/no is real; fee/eta/min are sample
  const delivReal = YES(t.delivery) ? true : NO(t.delivery) ? false : null
  const delivery = (delivReal ?? (cuisine !== 'shisha' && chance(0.7))) ? { fee: pick([0, 15, 20, 25, 30]), eta: int(20, 55), min: pick([100, 150, 200, 250]) } : null

  const moods = new Set(MOODS_BY_CUISINE[cuisine])
  if (amen.has('wifi') && amen.has('quiet')) moods.add('work')
  if (amen.has('nile-view') || amen.has('rooftop')) moods.add('date').add('celebrate')
  if (amen.has('kids')) moods.add('family')
  if (amen.has('shisha') || amen.has('sports-screens')) moods.add('friends')
  if (hours.some(([o, cl]) => cl > 1440 + 30 || cl - o >= 1440)) moods.add('late')

  const lv = LEVELS[cuisine]
  const price = t.amenity === 'fast_food' || t.amenity === 'ice_cream' ? Math.min(2, int(lv[0], lv[1])) : int(lv[0], lv[1])
  const variants = shuffle(VENUE_VARIANTS[cuisine])
  const scenic = amen.has('nile-view') ? SCENIC.nile : amen.has('rooftop') ? SCENIC.rooftop : amen.has('outdoor') ? SCENIC.outdoor : []
  const cover = scenic.length && chance(0.5) ? pick(scenic) : variants[0]
  const menu = makeMenu(cuisine, price, id)
  const signature = menu.flatMap((s) => s.items).filter((x) => x.tags.includes('best')).slice(0, 3)
  const gallery = [...new Set([cover, ...variants.slice(0, 2), ...(scenic.length ? [pick(scenic)] : [pick(GENERIC_VENUE)]), pick(EXTERIOR), ...signature.map((x) => x.img)])].slice(0, 7)
  const mains = menu.flatMap((s) => s.items).map((x) => x.price).sort((a, b) => a - b)
  const avg = round5(mains[Math.floor(mains.length * 0.6)] * 1.6)
  const rating = Math.round(between(3.6, 4.9) * 10) / 10
  const reviews = shuffle(REVIEW_POOL).slice(0, 4).map(([text, stars], i) => ({ name: REVIEWERS[(hash(id) + i * 3) % REVIEWERS.length], text, stars: Math.min(5, Math.max(2, stars + (rating < 4 && i === 0 ? -1 : 0))), daysAgo: int(1, 90) }))

  let slug = asciiSlug(nm.en) || asciiSlug(nm.ar) || 'place'
  if (slugs.has(slug)) slug = `${slug}-${area.id}`
  if (slugs.has(slug)) slug = `${slug}-${p.id}`
  slugs.add(slug)

  const start = (t.check_date || p.timestamp || '').slice(0, 4)
  const verified = c.realCount >= 3
  return {
    id,
    slug,
    ar: nm.ar,
    en: nm.en,
    cuisine,
    area: area.id,
    ...(() => { const a = addressOf({ ...t, __lat: p.lat, __lng: p.lng }, area, near); return { addressAr: a.addressAr, addressEn: a.addressEn, _addr: a.addressSource } })(),
    lat: +p.lat.toFixed(6),
    lng: +p.lng.toFixed(6),
    price,
    avg,
    hours,
    rating,
    ratingCount: int(15, 900),
    google: null,
    googleCount: null,
    visits: Math.round(Math.pow(rnd(), 2.2) * 6000) + 80,
    moods: [...moods],
    amenities,
    delivery,
    cover,
    gallery,
    descAr: DESC[cuisine][0],
    descEn: DESC[cuisine][1],
    since: int(2005, 2024),
    isNew: false,
    phone: c.phone,
    instagram: instagramOf(t),
    offers: chance(0.35) ? Array.from({ length: chance(0.25) ? 2 : 1 }, (_, i) => makeOffer(id, i)) : [],
    busy: popularTimes(cuisine),
    reviews,
    menu,
    // ---- added fields (real-data provenance)
    website: c.website,
    brand: clean(t.brand) || null,
    osmType: t.amenity ?? `shop:${t.shop}`,
    osmCuisine: t.cuisine ?? null,
    cuisineSource: cuisineFrom,
    hoursSource: parsed ? 'osm' : 'estimated',
    openingHoursRaw: t.opening_hours ?? null,
    amenitiesReal: real,
    takeaway: YES(t.takeaway) ? true : NO(t.takeaway) ? false : null,
    deliveryReal: delivReal,
    verified,
    lastEdited: start || null,
    source: { kind: 'osm', type: p.type, id: p.id, url: `https://www.openstreetmap.org/${p.type}/${p.id}` },
    sample: { menu: true, ratings: true, offers: true, reviews: true, photos: true, price: true, busy: true, moods: true, description: true, since: true, amenities: real.length !== amenities.length, delivery: delivery !== null },
  }
})

// addressSource as a real field (kept after the core fields for readability)
for (const r of restaurants) { r.addressSource = r._addr; delete r._addr }
restaurants.sort((a, b) => a.area.localeCompare(b.area) || Number(b.verified) - Number(a.verified) || a.en.localeCompare(b.en))

const usedAreas = new Set(restaurants.map((r) => r.area))
const areas = ALL_AREAS.filter((a, i) => i < AREAS.length || usedAreas.has(a.id))
writeFileSync(
  'data/restaurants.json',
  JSON.stringify({
    attribution: { text: 'Restaurant data © OpenStreetMap contributors (ODbL)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL-1.0', fetchedAt: src.fetchedAt },
    areas,
    cuisines: CUISINES,
    restaurants,
  }),
)
console.log(`${src.places.length} OSM places → ${cands.length} candidates after dedupe → ${restaurants.length} restaurants`)
console.log('dropped:', dropped)
console.log('candidates per area:', candPerArea)

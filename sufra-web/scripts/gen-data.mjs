// Builds data/restaurants.json: 120 fictional Cairo restaurants with menus,
// hours, ratings, offers and reviews. Deterministic (seeded) so reruns match.
// Fallback generator: the real-data pipeline is fetch-osm.mjs + build-real-data.mjs,
// which imports the helpers below (see scripts/README.md).
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MENUS } from './menus.mjs'

let seed = 20261012
/** Reset the shared PRNG (used by build-real-data.mjs for per-place determinism). */
export const setSeed = (n) => { seed = n | 0 }
export const rnd = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const pick = (a) => a[Math.floor(rnd() * a.length)]
export const between = (lo, hi) => lo + rnd() * (hi - lo)
export const int = (lo, hi) => Math.floor(between(lo, hi + 1))
export const chance = (p) => rnd() < p
export const shuffle = (a) => a.map((x) => [rnd(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1])
export const round5 = (v) => Math.max(5, Math.round(v / 5) * 5)

export const AREAS = [
  { id: 'zamalek', ar: 'الزمالك', en: 'Zamalek', lat: 30.0626, lng: 31.2197, streets: ['شارع ٢٦ يوليو|26th of July St', 'شارع أبو الفدا|Abu El Feda St', 'شارع البرازيل|Brazil St', 'شارع المنصور محمد|El Mansour Mohamed St'] },
  { id: 'garden-city', ar: 'جاردن سيتي', en: 'Garden City', lat: 30.0366, lng: 31.2311, streets: ['كورنيش النيل|Corniche El Nil', 'شارع القصر العيني|Kasr El Aini St', 'شارع أحمد راغب|Ahmed Ragheb St'] },
  { id: 'downtown', ar: 'وسط البلد', en: 'Downtown', lat: 30.0459, lng: 31.2422, streets: ['شارع طلعت حرب|Talaat Harb St', 'شارع قصر النيل|Kasr El Nil St', 'شارع شريف|Sherif St', 'شارع محمد محمود|Mohamed Mahmoud St'] },
  { id: 'dokki', ar: 'الدقي', en: 'Dokki', lat: 30.0384, lng: 31.2123, streets: ['شارع التحرير|Tahrir St', 'شارع مصدق|Mossadak St', 'شارع نوال|Nawal St'] },
  { id: 'mohandessin', ar: 'المهندسين', en: 'Mohandessin', lat: 30.0566, lng: 31.2003, streets: ['شارع جامعة الدول|Gameat El Dewal St', 'شارع شهاب|Shehab St', 'شارع لبنان|Lebanon St', 'شارع سوريا|Syria St'] },
  { id: 'maadi', ar: 'المعادي', en: 'Maadi', lat: 29.9602, lng: 31.2569, streets: ['شارع ٩|Road 9', 'شارع ٢٣٣|Road 233', 'كورنيش المعادي|Maadi Corniche', 'شارع اللاسلكي|Laselky St'] },
  { id: 'heliopolis', ar: 'مصر الجديدة', en: 'Heliopolis', lat: 30.0911, lng: 31.3225, streets: ['شارع بغداد|Baghdad St', 'شارع الأهرام|El Ahram St', 'شارع الميرغني|El Merghany St', 'شارع الثورة|El Thawra St'] },
  { id: 'nasr-city', ar: 'مدينة نصر', en: 'Nasr City', lat: 30.0561, lng: 31.3301, streets: ['شارع عباس العقاد|Abbas El Akkad St', 'شارع مكرم عبيد|Makram Ebeid St', 'شارع الطيران|El Tayaran St'] },
  { id: 'new-cairo', ar: 'التجمع الخامس', en: 'New Cairo', lat: 30.0074, lng: 31.4913, streets: ['شارع التسعين الشمالي|North 90th St', 'شارع التسعين الجنوبي|South 90th St', 'محور محمد نجيب|Mohamed Naguib Axis'] },
  { id: 'rehab', ar: 'الرحاب', en: 'Rehab', lat: 30.0606, lng: 31.493, streets: ['السوق الشرقي|Eastern Market', 'مول الرحاب ٢|Rehab Mall 2'] },
  { id: 'zayed', ar: 'الشيخ زايد', en: 'Sheikh Zayed', lat: 30.0444, lng: 30.98, streets: ['محور ٢٦ يوليو|26th of July Axis', 'الحي السادس عشر|District 16', 'أركان|Arkan Plaza'] },
  { id: 'october', ar: '٦ أكتوبر', en: '6th of October', lat: 29.9727, lng: 30.9446, streets: ['المحور المركزي|Central Axis', 'الحي المتميز|Distinguished District', 'شارع الحصري|El Hosary St'] },
]

// [cuisine, count, venue photo group, price levels, names "ar|en"]
const CONCEPTS = [
  ['cafe', 18, 'cafe', [2, 3], ['بُن وحكاية|Bun & Hekaya', 'رَكوة|Rakwa', 'نقطة قهوة|Coffee Dot', 'سُكّر بُني|Brown Sugar', 'فنجان|Fengan', 'حبّة|Habba Coffee', 'مَسا|Masa', 'ورقة وقلم|Paper & Pen', 'ريحة البُن|Bean Scent', 'بلاطة|Balata', 'غيمة|Ghaima', 'نخلة|Nakhla', 'الشبّاك|El Shebbak', 'قمرة|Qamra', 'هدوء|Hodoo', 'يوميات|Yawmiyat', 'سِرّ البُن|Bean Secret', 'بيت الرحى|Mill House']],
  ['egyptian', 14, 'egyptian', [1, 2], ['بيت الكشري|Koshari House', 'عم صابر|Am Saber', 'نجمة|Negma Ful & Falafel', 'سفرة ستي|Sitti\'s Table', 'المصطبة|El Mastaba', 'طبلية|Tableya', 'حارة زمان|Haret Zaman', 'أكلة بيتي|Akla Beity', 'الفلاحة|El Fallaha', 'ميدان|Midan', 'ونَس|Wanas', 'قعدة|Aada', 'بلدي|Baladi Kitchen', 'عربية الشيخ|El Sheikh Cart']],
  ['levant', 12, 'levant', [2, 3], ['بيروتي|Beiruti', 'ياسمين الشام|Yasmin El Sham', 'ساحة|Saha', 'زيتونة|Zeitouna', 'ليوان|Liwan', 'عنب|Enab', 'دمشقي|Dimashqi', 'بيت الصاج|Saj House', 'مزّة|Mezza', 'حارة شامية|Hara Shamiya', 'أرزة|Arza', 'حلبي|Halabi Grill']],
  ['grill', 10, 'grill', [2, 3], ['فحمة|Fahma', 'جمر|Jamr', 'نار وملح|Fire & Salt', 'الحاتي الذهبي|Golden Hati', 'شوّاية|Shawaya', 'ركن المشويات|Grill Corner', 'دخان|Dokhan Smokehouse', 'سيخ|Seekh', 'الكبابجي الصغير|Little Kababgy', 'بيت الضاني|Lamb House']],
  ['italian', 10, 'italian', [2, 4], ['نونا|Nonna', 'فورنو|Forno', 'لا بياتسا|La Piazza', 'بوتيغا|Bottega', 'تراتوريا ليموني|Trattoria Limone', 'فيا روما|Via Roma', 'بازيليكو|Basilico', 'باستا فريسكا|Pasta Fresca', 'إل كورتيلي|Il Cortile', 'روزمارينو|Rosmarino']],
  ['burger', 10, 'burger', [2, 2], ['سماش لاب|Smash Lab', 'بن آند بيف|Bun & Beef', 'جريدل|Griddle', 'ستريت ٩|Street 9', 'بيج بايت|Big Bite', 'فرايز آند كو|Fries & Co', 'ذا ستاك|The Stack', 'بليز|Blaze Burger', 'كرانش|Crunch', 'داينر ٥٠|Diner 50']],
  ['asian', 8, 'asian', [3, 4], ['ساكورا|Sakura', 'طوكيو ستيشن|Tokyo Station', 'ووك آند رول|Wok & Roll', 'ميسو|Miso', 'بانكوك ستريت|Bangkok Street', 'نودل بار|Noodle Bar', 'كوي|Koi', 'أومامي|Umami']],
  ['seafood', 7, 'seafood', [2, 4], ['مرسى|Marsa', 'صياد إسكندرية|Alex Fisherman', 'المينا|El Mina', 'أمواج|Amwaj', 'الشبكة|El Shabaka', 'بحري|Bahary', 'لؤلؤة|Lulua']],
  ['dessert', 7, 'dessert', [1, 2], ['قَطر|Qatr', 'سكّر نبات|Rock Candy', 'حلواني الحتة|El Hetta Sweets', 'كنافة وبس|Just Kunafa', 'تلج|Talg Gelato', 'وافل ثيوري|Waffle Theory', 'سحلب وقرفة|Sahlab & Cinnamon']],
  ['bakery', 6, 'bakery', [1, 2], ['فرن الحارة|Hara Oven', 'عجينة|Ageena', 'ساوردو كو|Sourdough Co.', 'خبّاز|Khabbaz', 'كرواسون باي|Croissant Bay', 'مخبز الصباح|Sabah Bakery']],
  ['healthy', 5, 'healthy', [2, 3], ['أخضر|Akhdar', 'جرين بول|Green Bowl', 'طازج|Tazeg', 'فِت كيتشن|Fit Kitchen', 'بستان|Bostan']],
  ['gulf', 5, 'gulf', [2, 3], ['مندي الديرة|Deira Mandi', 'مجلس|Majlis', 'الخيمة|El Kheima', 'بيت الكبسة|Kabsa House', 'نجد|Najd']],
  ['shisha', 4, 'shisha', [1, 2], ['قهوة الأصحاب|Ashab Ahwa', 'الحكاية|El Hekaya', 'سهرانين|Sahraneen', 'قهوة النيل|Nile Ahwa']],
  ['indian', 2, 'indian', [2, 3], ['بيت المسالا|Masala House', 'تاج كاري|Taj Curry']],
  ['mexican', 2, 'mexican', [2, 3], ['كاسا تاكو|Casa Taco', 'سالسا كانتينا|Salsa Cantina']],
]

export const CUISINES = {
  cafe: { ar: 'كافيه وقهوة مختصة', en: 'Café & specialty coffee', group: 'drinks' },
  egyptian: { ar: 'مصري', en: 'Egyptian', group: 'eastern' },
  levant: { ar: 'شامي ولبناني', en: 'Levantine & Lebanese', group: 'eastern' },
  grill: { ar: 'مشويات', en: 'Grills', group: 'eastern' },
  italian: { ar: 'إيطالي', en: 'Italian', group: 'western' },
  burger: { ar: 'برجر وأمريكي', en: 'Burgers & American', group: 'western' },
  asian: { ar: 'آسيوي وسوشي', en: 'Asian & sushi', group: 'asian' },
  seafood: { ar: 'مأكولات بحرية', en: 'Seafood', group: 'eastern' },
  dessert: { ar: 'حلويات', en: 'Desserts', group: 'sweets' },
  bakery: { ar: 'مخبوزات', en: 'Bakery', group: 'sweets' },
  healthy: { ar: 'صحي', en: 'Healthy', group: 'western' },
  gulf: { ar: 'خليجي ومندي', en: 'Gulf & mandi', group: 'eastern' },
  shisha: { ar: 'قهوة بلدي وشيشة', en: 'Ahwa & shisha', group: 'drinks' },
  indian: { ar: 'هندي', en: 'Indian', group: 'asian' },
  mexican: { ar: 'مكسيكي', en: 'Mexican', group: 'western' },
}

// What people come for; used by the "what's the plan?" picker.
export const MOODS_BY_CUISINE = {
  cafe: ['work', 'drinks', 'friends', 'breakfast', 'date'],
  egyptian: ['eat', 'family', 'breakfast', 'quick', 'late'],
  levant: ['eat', 'family', 'friends', 'date'],
  grill: ['eat', 'family', 'celebrate', 'friends'],
  italian: ['eat', 'date', 'family', 'celebrate'],
  burger: ['eat', 'friends', 'quick', 'late'],
  asian: ['eat', 'date', 'celebrate'],
  seafood: ['eat', 'family', 'celebrate'],
  dessert: ['drinks', 'friends', 'date', 'late'],
  bakery: ['breakfast', 'quick', 'work', 'drinks'],
  healthy: ['eat', 'work', 'breakfast', 'quick'],
  gulf: ['eat', 'family', 'celebrate'],
  shisha: ['friends', 'drinks', 'late'],
  indian: ['eat', 'date', 'friends'],
  mexican: ['eat', 'friends', 'date'],
}

export const AMENITY_ODDS = {
  wifi: { cafe: 0.98, bakery: 0.7, healthy: 0.8, shisha: 0.7, _: 0.45 },
  outlets: { cafe: 0.8, bakery: 0.5, healthy: 0.6, _: 0.15 },
  quiet: { cafe: 0.45, bakery: 0.4, healthy: 0.5, italian: 0.3, asian: 0.4, _: 0.12 },
  parking: { _: 0.45 },
  outdoor: { _: 0.5 },
  kids: { egyptian: 0.5, grill: 0.5, gulf: 0.6, italian: 0.4, burger: 0.4, seafood: 0.4, _: 0.15 },
  wheelchair: { _: 0.4 },
  shisha: { shisha: 1, cafe: 0.25, levant: 0.35, gulf: 0.4, _: 0.05 },
  'live-music': { italian: 0.2, levant: 0.25, cafe: 0.15, _: 0.08 },
  prayer: { gulf: 0.8, grill: 0.4, egyptian: 0.4, _: 0.2 },
  'sports-screens': { shisha: 0.9, burger: 0.4, cafe: 0.2, _: 0.08 },
  'pet-friendly': { cafe: 0.3, healthy: 0.3, bakery: 0.25, _: 0.08 },
  valet: { italian: 0.4, asian: 0.5, seafood: 0.3, _: 0.08 },
}

export const REVIEW_POOL = [
  ['الأكل جميل جداً والخدمة سريعة، هرجع تاني أكيد', 5],
  ['المكان هادي ومناسب للشغل، الواي فاي ممتاز', 5],
  ['الأسعار معقولة بالنسبة للكمية، بس الزحمة يوم الخميس كتير', 4],
  ['طلبت ديلفري ووصل سخن وفي ميعاده', 5],
  ['القعدة حلوة مع الأصحاب، بس الموسيقى عالية شوية', 4],
  ['جربت الطبق المميز عندهم وكان فوق التوقعات', 5],
  ['الخدمة محتاجة تتحسن شوية، لكن الأكل نفسه حلو', 3],
  ['مكان عائلي ونضيف ومناسب للأطفال', 5],
  ['حجزت من سُفرة ولقيت الطاولة جاهزة أول ما وصلت', 5],
  ['القهوة ممتازة والحلو طازة', 5],
  ['الأسعار زادت شوية عن الأول بس لسه يستاهل', 4],
  ['الإطلالة تحفة وقت الغروب', 5],
  ['الأكل كويس بس الانتظار طول شوية في الويك إند', 3],
  ['الموظفين ذوق جداً وساعدونا نختار', 5],
]
export const REVIEWERS = ['سارة م.', 'أحمد ع.', 'نور هـ.', 'محمد س.', 'يارا ك.', 'كريم ف.', 'مريم ح.', 'عمر ش.', 'هبة ر.', 'يوسف ن.', 'دينا أ.', 'مصطفى ج.', 'لينا ط.', 'زياد ب.']

export const HOURS = {
  cafe: [8 * 60, 25 * 60],
  bakery: [7 * 60, 23 * 60],
  healthy: [8 * 60, 23 * 60],
  egyptian: [7 * 60, 26 * 60],
  dessert: [12 * 60, 26 * 60],
  shisha: [10 * 60, 27 * 60],
  _: [12 * 60, 25 * 60],
}

export const DESC = {
  cafe: ['قهوة مختصة محمصة طازة، وقعدة مريحة للشغل أو للدردشة.', 'Freshly roasted specialty coffee and a comfortable spot to work or catch up.'],
  egyptian: ['أكل بيتي مصري على أصوله، من الفول والطعمية للفتة والملوخية.', 'Proper home-style Egyptian food, from ful and taameya to fattah and molokhia.'],
  levant: ['مازة شامية ومشاوي على الفحم وخبز طازة من الفرن.', 'Levantine mezze, charcoal grills and bread fresh from the oven.'],
  grill: ['مشويات على الفحم، صواني للعيلة ولحمة متبلة على طريقتنا.', 'Charcoal grills, family trays and meat marinated our way.'],
  italian: ['عجينة بتختمر ٤٨ ساعة، باستا طازة وصوصات بطيئة.', '48-hour dough, fresh pasta and slow-cooked sauces.'],
  burger: ['برجر سماش على الصاج، بطاطس مقرمشة وصوصات بيتي.', 'Griddle-smashed burgers, crisp fries and house sauces.'],
  asian: ['سوشي ورامن ومطبخ آسيوي مفتوح قدامك.', 'Sushi, ramen and an open Asian kitchen.'],
  seafood: ['سمك طازة كل يوم، تختاره وإحنا نطبخه زي ما تحب.', 'Fresh fish daily: pick yours and we cook it how you like.'],
  dessert: ['حلويات شرقية وغربية وآيس كريم معمول هنا.', 'Eastern and western sweets plus house-made ice cream.'],
  bakery: ['مخبوزات من الفجر، كرواسون بالزبدة وعيش ساوردو.', 'Baked from dawn: butter croissants and sourdough.'],
  healthy: ['بولز وسلطات وعصاير طبيعية بسعرات محسوبة.', 'Bowls, salads and natural juices with counted calories.'],
  gulf: ['مندي وكبسة ومجلس عربي للعيلة والعزومات.', 'Mandi, kabsa and Arabic majlis seating for family gatherings.'],
  shisha: ['قهوة بلدي، شاي كشري وماتشات على الشاشة الكبيرة.', 'A classic ahwa: loose-leaf tea and matches on the big screen.'],
  indian: ['كاري وبرياني وخبز نان من التندور.', 'Curries, biryani and naan from the tandoor.'],
  mexican: ['تاكوز وبوريتو وصوصات حارة بالمزاج.', 'Tacos, burritos and hot sauces to taste.'],
}

export const VENUE_VARIANTS = {
  cafe: ['venue-cafe-1', 'venue-cafe-2', 'venue-cafe-3', 'venue-cafe-4', 'venue-cafe-5', 'venue-coffee-1', 'venue-coffee-2', 'venue-coffee-3', 'venue-cowork-1', 'venue-cowork-2'],
  egyptian: ['venue-egyptian-1', 'venue-egyptian-2', 'venue-egyptian-3'],
  levant: ['venue-levant-1', 'venue-levant-2', 'venue-levant-3'],
  grill: ['venue-grill-1', 'venue-grill-2', 'venue-grill-3'],
  italian: ['venue-italian-1', 'venue-italian-2', 'venue-italian-3'],
  burger: ['venue-burger-1', 'venue-burger-2', 'venue-burger-3'],
  asian: ['venue-asian-1', 'venue-asian-2', 'venue-asian-3'],
  seafood: ['venue-seafood-1', 'venue-seafood-2', 'venue-seafood-3'],
  dessert: ['venue-dessert-1', 'venue-dessert-2', 'venue-dessert-3'],
  bakery: ['venue-bakery-1', 'venue-bakery-2', 'venue-bakery-3'],
  healthy: ['venue-healthy-1', 'venue-healthy-2'],
  gulf: ['venue-gulf-1', 'venue-gulf-2'],
  shisha: ['venue-shisha-1', 'venue-shisha-2'],
  indian: ['venue-indian-1', 'venue-indian-2'],
  mexican: ['venue-mexican-1', 'venue-mexican-2'],
}
export const GENERIC_VENUE = ['venue-restaurant-1', 'venue-restaurant-2', 'venue-restaurant-3', 'venue-restaurant-4', 'venue-restaurant-5']
export const SCENIC = { rooftop: ['venue-rooftop-1', 'venue-rooftop-2', 'venue-rooftop-3'], nile: ['venue-nile-1', 'venue-nile-2'], outdoor: ['venue-outdoor-1', 'venue-outdoor-2', 'venue-outdoor-3'] }
export const EXTERIOR = ['venue-exterior-1', 'venue-exterior-2', 'venue-exterior-3', 'venue-exterior-4']

export const PRICE_FACTOR = { 1: 0.72, 2: 1, 3: 1.4, 4: 1.9 }

export function slugify(en) {
  return en.toLowerCase().replace(/&/g, 'and').replace(/['.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function popularTimes(cuisine) {
  // Relative busyness per hour 0..23 (0-100).
  const peaks = {
    cafe: [[10, 40], [13, 55], [19, 85], [22, 70]],
    bakery: [[8, 90], [11, 60], [17, 50]],
    healthy: [[9, 60], [13, 85], [19, 50]],
    egyptian: [[9, 70], [15, 80], [22, 85], [1, 50]],
    shisha: [[17, 40], [21, 90], [24, 100]],
    dessert: [[17, 40], [21, 90], [24, 80]],
    _: [[14, 70], [21, 95]],
  }[cuisine] ?? [[14, 70], [21, 95]]
  return Array.from({ length: 24 }, (_, h) => {
    let v = 4
    for (const [p, amp] of peaks) {
      const d = Math.min(Math.abs(h - (p % 24)), 24 - Math.abs(h - (p % 24)))
      v += amp * Math.exp(-(d * d) / 5)
    }
    return Math.min(100, Math.round(v * between(0.85, 1.1)))
  })
}

export function makeMenu(cuisine, level, rid) {
  const f = PRICE_FACTOR[level] * between(0.92, 1.1)
  let n = 0
  return MENUS[cuisine].map(([ar, en, items]) => ({
    ar,
    en,
    items: items
      .filter((x, i) => i < 2 || !chance(0.12))
      .map((x) => ({
        id: `${rid}-${++n}`,
        ar: x.ar,
        en: x.en,
        descAr: x.descAr,
        descEn: x.descEn,
        price: round5(x.price * f),
        img: `dish-${x.img}`,
        tags: x.tags,
        kcal: int(3, 16) * 50,
      })),
  }))
}

export function makeOffer(r, i) {
  const kinds = [
    () => ({ kind: 'percent', value: pick([10, 15, 20, 25, 30]), ar: 'خصم على الفاتورة كلها', en: 'Off the whole bill' }),
    () => ({ kind: 'happy-hour', value: pick([20, 25, 30]), from: 15 * 60, to: 18 * 60, ar: 'هابي أور من ٣ لـ ٦ العصر', en: 'Happy hour 3–6 PM' }),
    () => ({ kind: 'free-delivery', value: 0, ar: 'توصيل مجاني للطلبات فوق ٣٠٠ ج', en: 'Free delivery over EGP 300' }),
    () => ({ kind: 'first-visit', value: 20, ar: 'أول زيارة من سُفرة', en: 'Your first visit via Sufra' }),
    () => ({ kind: 'plus', value: 15, ar: 'حصري لأعضاء سُفرة بلس', en: 'Sufra Plus members only' }),
    () => ({ kind: 'bogo', value: 50, ar: 'التاني بنص التمن على المشروبات', en: 'Second drink half price' }),
    () => ({ kind: 'group', value: 15, ar: 'خصم للمجموعات ٦ أفراد أو أكتر', en: 'Groups of 6 or more' }),
  ]
  const o = pick(kinds)()
  return {
    id: `${r}-o${i}`,
    ...o,
    code: `SUFRA${int(10, 99)}`,
    days: chance(0.5) ? [0, 1, 2, 3, 4, 5, 6] : shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, int(2, 4)).sort(),
    endsInDays: int(3, 40),
  }
}

function genRestaurants() {
  const out = []
  const areaQueue = shuffle(AREAS.flatMap((a) => Array(10).fill(a.id)))
  let idx = 0
  for (const [cuisine, count, , levels, names] of CONCEPTS) {
    for (let k = 0; k < count; k++) {
      const [ar, en] = names[k].split('|')
      const areaId = areaQueue[idx++]
      const area = AREAS.find((a) => a.id === areaId)
      const id = `r${String(idx).padStart(3, '0')}`
      const level = int(levels[0], levels[1])
      const amen = Object.entries(AMENITY_ODDS)
        .filter(([, odds]) => chance(odds[cuisine] ?? odds._))
        .map(([k2]) => k2)
      const riverside = ['zamalek', 'garden-city', 'maadi', 'downtown'].includes(area.id)
      if (riverside && chance(0.3)) amen.push('nile-view')
      if (chance(0.14)) amen.push('rooftop')
      if (cuisine !== 'shisha' && cuisine !== 'dessert' && chance(0.85)) amen.push('reservations')
      if (cuisine === 'shisha' && chance(0.3)) amen.push('reservations')
      const delivery = cuisine !== 'shisha' && chance(0.78)
      const moods = new Set(MOODS_BY_CUISINE[cuisine])
      if (amen.includes('wifi') && amen.includes('quiet')) moods.add('work')
      if (amen.includes('nile-view') || amen.includes('rooftop')) moods.add('date').add('celebrate')
      if (amen.includes('kids')) moods.add('family')
      if (amen.includes('shisha') || amen.includes('sports-screens')) moods.add('friends')
      const [open, close] = HOURS[cuisine] ?? HOURS._
      const o = open + pick([0, 0, 0, 60, -60])
      const c = close + pick([0, 0, 60, -60])
      const hours = Array.from({ length: 7 }, (_, d) => (d === 5 && chance(0.25) ? [Math.max(o, 13 * 60), c] : [o, c + (d === 4 || d === 5 ? 60 : 0)]))
      const variants = shuffle(VENUE_VARIANTS[cuisine])
      const scenic = amen.includes('nile-view') ? SCENIC.nile : amen.includes('rooftop') ? SCENIC.rooftop : amen.includes('outdoor') ? SCENIC.outdoor : []
      const cover = scenic.length && chance(0.6) ? pick(scenic) : variants[0]
      const menu = makeMenu(cuisine, level, id)
      const signature = menu.flatMap((s) => s.items).filter((x) => x.tags.includes('best')).slice(0, 3)
      const gallery = [...new Set([cover, ...variants.slice(0, 2), ...(scenic.length ? [pick(scenic)] : [pick(GENERIC_VENUE)]), pick(EXTERIOR), ...signature.map((x) => x.img)])].slice(0, 7)
      const mains = menu.flatMap((s) => s.items).map((x) => x.price).sort((a, b) => a - b)
      const avg = round5(mains[Math.floor(mains.length * 0.6)] * 1.6)
      const appRating = Math.round(between(3.6, 4.95) * 10) / 10
      const google = Math.round(Math.min(4.9, Math.max(3.5, appRating + between(-0.4, 0.3))) * 10) / 10
      const [stAr, stEn] = pick(area.streets).split('|')
      const num = int(2, 140)
      const reviews = shuffle(REVIEW_POOL)
        .slice(0, 4)
        .map(([text, stars], i) => ({ name: REVIEWERS[(idx + i * 3) % REVIEWERS.length], text, stars: Math.min(5, Math.max(2, stars + (appRating < 4 && i === 0 ? -1 : 0))), daysAgo: int(1, 90) }))
      out.push({
        id,
        slug: slugify(en),
        ar,
        en,
        cuisine,
        area: area.id,
        addressAr: `${num.toLocaleString('ar-EG')} ${stAr}، ${area.ar}`,
        addressEn: `${num} ${stEn}, ${area.en}`,
        lat: +(area.lat + between(-0.011, 0.011)).toFixed(5),
        lng: +(area.lng + between(-0.013, 0.013)).toFixed(5),
        price: level,
        avg,
        hours,
        rating: appRating,
        ratingCount: int(40, 2400),
        google,
        googleCount: int(120, 9800),
        visits: Math.round(Math.pow(rnd(), 2.2) * 9000) + 150,
        moods: [...moods],
        amenities: amen,
        delivery: delivery ? { fee: pick([0, 15, 20, 25, 30]), eta: int(20, 55), min: pick([100, 150, 200, 250]) } : null,
        cover,
        gallery,
        descAr: DESC[cuisine][0],
        descEn: DESC[cuisine][1],
        since: int(2008, 2026),
        isNew: chance(0.1),
        phone: `01${pick([0, 1, 2, 5])}${int(1000000, 9999999)}`.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3'),
        instagram: `@${slugify(en).replace(/-/g, '')}`,
        offers: chance(0.45) ? Array.from({ length: chance(0.3) ? 2 : 1 }, (_, i) => makeOffer(id, i)) : [],
        busy: popularTimes(cuisine),
        reviews,
        menu,
      })
    }
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
const restaurants = genRestaurants()
mkdirSync('data', { recursive: true })
writeFileSync(
  'data/restaurants.json',
  JSON.stringify({ areas: AREAS.map(({ streets, ...a }) => a), cuisines: CUISINES, restaurants }),
)
const items = restaurants.reduce((s, r) => s + r.menu.reduce((t, x) => t + x.items.length, 0), 0)
console.log(`${restaurants.length} restaurants, ${items} menu items, ${restaurants.filter((r) => r.offers.length).length} with offers`)
}

# نشر موقع سُفرة على Vercel · Deploying Sufra web to Vercel

<div dir="rtl">

## بالعربي

الموقع (Vite + React) بيتبني لملفات ثابتة في `dist/`، ومعاه دالة سيرفر واحدة `api/ask.ts` (Edge Function) للكونسيرج «اسأل سُفرة» اللي بيستخدم Claude. **الموقع بيشتغل من غير أي مفاتيح**: خريطة OpenStreetMap، ومحرك ترشيحات محلي، ومن غير تقييمات جوجل.

### ١. ارفع الكود على GitHub
```bash
git remote add origin https://github.com/<اسمك>/<الريبو>.git
git push -u origin main
```

### ٢. استورد المشروع في Vercel
1. ادخل على vercel.com ← **Add New → Project** ← اختار الريبو.
2. **Root Directory**: اختار `sufra-web` (الأسهل — Vercel هيقرا `sufra-web/vercel.json` ويلاقي `api/ask.ts` جنبه).
   - لو سبتها على جذر الريبو، الملف `vercel.json` اللي في الجذر بيبني `sufra-web/` والملف `api/ask.ts` اللي في الجذر بيوصّل للدالة. الاتنين شغالين.
3. Framework: **Vite** · Build: `npm run build` · Output: `dist` (متظبطين في `vercel.json`).

### ٣. المتغيرات (Settings → Environment Variables)
| المتغير | لازم؟ | فايدته |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | اختياري | يشغّل «اسأل سُفرة» بـ Claude. **سرّي** — بيفضل على السيرفر بس، وعمره ما يتبعت للمتصفح. |
| `VITE_GOOGLE_MAPS_KEY` | اختياري | خريطة جوجل بدل OpenStreetMap + تقييم جوجل الحقيقي وعدد المراجعات في صفحة المطعم (مع ذكر Google). المفتاح ده **بيبان في المتصفح**، فلازم تقفله في Google Cloud على دومينك (HTTP referrers) وعلى Maps JavaScript API و Places API (New) بس. |
| `VITE_GOOGLE_MAP_ID` | اختياري | Map ID من Google Cloud لشكل الخريطة والعلامات في الإنتاج. |

أي متغير بيبدأ بـ `VITE_` بيتحط في الكود وقت البناء، فلو غيّرته اعمل **Redeploy**.

### ٤. انشر
**Deploy**. كل `git push` على `main` بيعمل نشر جديد، وكل Pull Request بياخد رابط معاينة.

### ٥. دومين خاص
**Settings → Domains → Add** واكتب الدومين (مثلًا `sufra.eg`). Vercel هيقولك تعمل إيه في DNS:
- الدومين الأساسي: سجل `A` لـ `76.76.21.21`
- `www`: سجل `CNAME` لـ `cname.vercel-dns.com`
شهادة HTTPS بتطلع لوحدها (و«استخدم موقعي» محتاج HTTPS).

### ملاحظات
- **الخريطة**: بلاطات `tile.openstreetmap.org` مناسبة لموقع تجريبي/قليل الزيارات (لازم ذكر «© OpenStreetMap contributors» — موجود). لو الزيارات كبرت، استخدم مزوّد بلاطات (MapTiler/Stadia) أو مفتاح جوجل. لو البلاطات اتمنعت الموقع بيرجع تلقائي للخريطة المبسّطة.
- **«استخدم موقعي»** بيشتغل على HTTPS بس، والموقع بيتحفظ في متصفح المستخدم (١٢ ساعة) ومش بيتبعت لأي سيرفر غير Photon (لعنوان مقروء) ومع سؤال الكونسيرج.
- **التكلفة**: الكونسيرج بيستخدم Claude Haiku 5.5 (الموديل السريع) مع cache للكتالوج. حط حد إنفاق في Anthropic Console.
- **تجربة محلية**: `cp .env.example .env.local`، حط المفاتيح، وبعدين `npm run dev` (السيرفر المحلي بيشغّل `api/ask.ts` كمان).

</div>

## English

The site (Vite + React) builds to static files in `dist/`, plus one server function, `api/ask.ts` (Edge Function), for the Claude-powered "Ask Sufra" concierge. **It works with no keys at all**: OpenStreetMap map, on-device recommender, no Google ratings.

### 1. Push to GitHub
```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Import in Vercel
1. vercel.com → **Add New → Project** → pick the repository.
2. **Root Directory**: choose `sufra-web` (simplest — Vercel reads `sufra-web/vercel.json` and finds `api/ask.ts` next to it).
   - Leaving it at the repo root also works: the root `vercel.json` builds `sufra-web/` and the root `api/ask.ts` re-exports the function.
3. Framework **Vite** · Build `npm run build` · Output `dist` (already set in `vercel.json`, with an SPA rewrite to `index.html` for everything except `/api/*` and assets).

### 3. Environment variables (Settings → Environment Variables)
| Variable | Required? | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | optional | Turns on the Claude concierge. **Secret** — read only by the server function, never sent to the browser. |
| `VITE_GOOGLE_MAPS_KEY` | optional | Google map instead of OpenStreetMap, plus live Google rating + review count on restaurant pages (attributed to Google). This key **is visible in the browser**: restrict it in Google Cloud to your domains (HTTP referrers) and to Maps JavaScript API + Places API (New). |
| `VITE_GOOGLE_MAP_ID` | optional | A Google Cloud map ID for production map styling/advanced markers. |

`VITE_*` values are baked in at build time — **redeploy** after changing them. Without `VITE_GOOGLE_MAPS_KEY`, no Google rating, sort or rail is shown anywhere (the data has none, and the site never shows made-up Google numbers).

### 4. Deploy
Click **Deploy**. Every push to `main` redeploys; every pull request gets a preview URL.

### 5. Custom domain
**Settings → Domains → Add** your domain (e.g. `sufra.eg`) and follow the DNS instructions:
- apex: `A` record → `76.76.21.21`
- `www`: `CNAME` → `cname.vercel-dns.com`
HTTPS certificates are automatic (and "Use my location" requires HTTPS).

### Notes
- **Map tiles**: `tile.openstreetmap.org` is fine for a demo/low-traffic site (attribution "© OpenStreetMap contributors" is shown). For real traffic use a tile provider (MapTiler, Stadia) or the Google key. If tiles are blocked the site falls back to its simplified offline map automatically.
- **Location**: GPS needs HTTPS; the fix is kept in the user's browser for 12 h and only sent to Photon (komoot, for a readable label) and with a concierge question.
- **Cost**: the concierge uses Claude Haiku 5.5 (the fast model) with prompt caching of the restaurant catalogue. Set a spend limit in the Anthropic Console. Consider Vercel's firewall/rate limiting for `/api/ask`.
- **Local**: `cp .env.example .env.local`, fill in keys, `npm run dev` — the dev server also serves `api/ask.ts`.
- **Static preview** (no server): the build without `VERCEL=1` doesn't call `/api/ask` at all, so there are no 404s; set `SUFRA_API=1` at build time if you host the function elsewhere.

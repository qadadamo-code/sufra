/**
 * Arabic-aware text matching shared by the search box, the local concierge and the /api/ask function.
 * Pure functions, relative imports only (the Vercel edge bundle imports this file too).
 */

/** Normalise Arabic for matching: strip tashkeel/tatweel, unify أ/إ/آ/ٱ→ا, ى→ي, ة→ه, ؤ→و, ئ→ي, Arabic-Indic digits → Latin, lowercase Latin. */
export function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // tashkeel, superscript alef, tatweel — NOT U+0660–0669 (digits)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[éèê]/g, "e")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip a leading Arabic article/conjunction ("ال", "وال", "بال", "و") so "الكشري" ≈ "كشري". */
export function stem(w: string): string {
  const x = w.replace(/^(?:وال|بال|فال|كال|لل|ال)(?=..)/, "").replace(/^و(?=...)/, "");
  return x;
}

/** Common Egyptian / Levantine / transliterated variants mapped to one canonical token (both sides normalised). */
const SYN: Record<string, string> = {};
const group = (canon: string, ...alts: string[]) => {
  for (const a of [canon, ...alts]) SYN[norm(a)] = norm(canon);
};
group("طعميه", "فلافل", "falafel", "taameya", "ta3meya");
group("كشري", "كشرى", "koshari", "koshary", "kushari");
group("شاورما", "شاورمه", "شورما", "shawarma", "shawerma");
group("فطار", "فطور", "افطار", "breakfast", "brunch");
group("قهوه", "كوفي", "كافي", "coffee", "ahwa", "قهوة");
group("كافيه", "كافيهات", "cafe", "café", "coffeeshop");
group("برجر", "برغر", "بيرجر", "burger", "burgers");
group("بيتزا", "pizza");
group("سمك", "اسماك", "سمكه", "fish", "seafood");
group("فراخ", "دجاج", "جاج", "chicken");
group("لحمه", "لحم", "meat", "beef");
group("حلويات", "حلو", "sweets", "dessert", "desserts");
group("عصير", "عصاير", "juice");
group("رخيص", "رخيصه", "ارخص", "cheap", "budget");
group("دلوقتي", "هلق", "هلا", "الحين", "now");
group("عايز", "عاوز", "بدي", "ابغي", "want");
group("مشويات", "مشاوي", "grill", "grills", "bbq");
group("سوشي", "sushi");
group("فول", "ful", "foul");
group("كبده", "كبدة", "liver");
group("حواوشي", "hawawshi");
group("مندي", "mandi");
group("ايطالي", "italian");
group("مكرونه", "معكرونه", "باستا", "pasta");

/** Canonical token for a (normalised) word: synonyms first, then without its article. */
export function canon(w: string): string {
  return SYN[w] ?? SYN[stem(w)] ?? stem(w);
}

/** Tokenise to canonical forms. */
export function tokens(s: string): string[] {
  return norm(s).split(" ").filter(Boolean).map(canon);
}

/** Damerau–Levenshtein distance with an early exit once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length, n = b.length;
  let prev2: number[] = new Array(n + 1).fill(0);
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** Typo budget by word length: short words must match exactly. */
export const typoBudget = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : 2);

/**
 * How well does query token `q` match candidate token `t`? 1 = exact, ~0.9 prefix, ~0.7 one typo, 0 = no match.
 * Both must already be canonical (see `tokens`).
 */
export function tokenScore(q: string, t: string): number {
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (q.length >= 2 && t.startsWith(q)) return 0.9 - Math.min(0.3, (t.length - q.length) * 0.03);
  if (q.length >= 4 && t.includes(q)) return 0.7;
  const budget = typoBudget(Math.min(q.length, t.length));
  if (!budget) return 0;
  // compare against the same-length prefix too, so a typo while still typing ("كشرر" → "كشري") matches
  const d = Math.min(editDistance(q, t, budget), t.length > q.length ? editDistance(q, t.slice(0, q.length), budget) + 0.5 : 99);
  return d <= budget ? 0.75 - d * 0.12 : 0;
}

/** Best score of a query token against a bag of candidate tokens. */
export function bestTokenScore(q: string, bag: string[]): number {
  let best = 0;
  for (const t of bag) {
    const s = tokenScore(q, t);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}

/**
 * Score a free-text query against a field: every query word must match some word (AND), the result is the mean of
 * the per-word scores (0 when any word misses). Also accepts the whole phrase as a substring.
 */
export function fuzzyScore(query: string, field: string | string[]): number {
  const qs = tokens(query);
  if (!qs.length) return 0;
  const bag = Array.isArray(field) ? field : tokens(field);
  let sum = 0;
  for (const q of qs) {
    const s = bestTokenScore(q, bag);
    if (!s) return 0;
    sum += s;
  }
  return sum / qs.length;
}

/** Does normalised text contain the (normalised) phrase as whole words, allowing a leading article/conjunction? */
export function hasPhrase(text: string, phrase: string): boolean {
  const w = norm(phrase);
  if (!w) return false;
  const pre = "(?:^|\\s)(?:و|ف|ب|ل|في|بال|وال|لل|ال)?";
  const re = new RegExp(pre + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|\\s|ين|ات|ه)", "u");
  if (re.test(text)) return true;
  // typo-tolerant single-word fallback (e.g. "الزمالكك", "مهندسن")
  if (!w.includes(" ") && w.length >= 5) {
    const budget = typoBudget(w.length) > 1 ? 1 : typoBudget(w.length);
    return text.split(" ").some((t) => Math.abs(stem(t).length - w.length) <= 1 && editDistance(stem(t), w, budget) <= budget);
  }
  return false;
}

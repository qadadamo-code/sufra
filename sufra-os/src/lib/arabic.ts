/** Normalise Arabic/English for search: strip tashkeel/tatweel, unify alef/yaa/taa marbuta, Arabic-Indic digits → Latin. */
export function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every query word must prefix-match some word of the haystack (after normalising; leading "ال" ignored). */
export function matches(haystack: string, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const words = norm(haystack).split(" ").flatMap((w) => [w, w.replace(/^(?:ال|وال|بال)(?=..)/, "")]);
  const hay = norm(haystack);
  return q.split(" ").every((t) => words.some((w) => w.startsWith(t)) || hay.includes(t));
}

/** Arabic-Indic → Latin digits (PIN pads and phone inputs accept both). */
export const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

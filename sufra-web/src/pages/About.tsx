import { ExternalLink } from "lucide-react";
import { Reveal } from "@/components/sufra/Reveal";
import { useLang } from "@/lib/i18n";
import { imgUrl, photoCredits } from "@/lib/media";

const LICENSE_NAMES: Record<string, string> = { by: "CC BY", "by-sa": "CC BY-SA", "by-nd": "CC BY-ND", "by-nc": "CC BY-NC", "by-nc-sa": "CC BY-NC-SA", "by-nc-nd": "CC BY-NC-ND", cc0: "CC0", pdm: "Public Domain Mark" };

export default function About() {
  const { L } = useLang();
  const entries = Object.entries(photoCredits).filter(([k]) => imgUrl(k)).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="wrap gutter pb-16 pt-8">
      <Reveal>
        <p className="sf-kicker">{L("عن سُفرة", "About Sufra")}</p>
        <h1 className="max-w-3xl text-[36px] font-bold leading-tight sm:text-[56px]">{L("سُفرة واحدة لكل مطاعم القاهرة", "One table for all of Cairo's restaurants")}</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          {L("سُفرة = الصينية اللي بتتفرد عليها الأكلة. إحنا بنجمعلك المطاعم والكافيهات: تكتشف، تحجز، وتطلب، والمطاعم بتدير كل ده من نفس المكان.", "Sufra is the tray a meal is spread on. We bring restaurants and cafés together: you discover, book and order, and restaurants run it all from one place.")}
        </p>
        <p className="mt-3 max-w-2xl rounded-2xl border border-brass/40 bg-brass-soft/60 p-4 text-sm">
          {L("دي نسخة تجريبية: كل المطاعم والأسماء والتقييمات والعناوين وأرقام التليفونات خيالية. الصور حقيقية ومرخّصة برخص المشاع الإبداعي — وحقوقها تحت.", "This is a demo: every restaurant, name, rating, address and phone number is fictional. The photos are real and Creative Commons licensed — credited below.")}
        </p>
      </Reveal>

      <section className="mt-12" aria-labelledby="credits-h">
        <h2 id="credits-h" className="text-[28px] font-bold">{L("حقوق الصور", "Photo credits")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{L(`${entries.length} صورة. اضغط على الاسم عشان تشوف المصدر والرخصة.`, `${entries.length} photos. Follow a link for the source and licence.`)}</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(([k, c]) => (
            <li key={k} className="flex gap-3 rounded-2xl border bg-card p-3">
              <img src={imgUrl(k)!} alt="" loading="lazy" className="size-16 shrink-0 rounded-xl object-cover" />
              <div className="min-w-0 text-sm" dir="ltr" lang="en">
                <p className="truncate font-semibold">{c.source_url ? <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">{c.title || k}</a> : c.title || k}</p>
                <p className="truncate text-muted-foreground">
                  by {c.creator_url ? <a href={c.creator_url} target="_blank" rel="noopener noreferrer" className="hover:underline">{c.creator || "unknown"}</a> : c.creator || "unknown"}
                </p>
                <p className="text-xs">
                  {c.license_url ? (
                    <a href={c.license_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      {LICENSE_NAMES[c.license ?? ""] ?? c.license?.toUpperCase()} {c.license_version}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : (
                    LICENSE_NAMES[c.license ?? ""] ?? c.license
                  )}
                  {c.provider ? <span className="text-muted-foreground"> · via {c.provider}</span> : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 grid gap-3 text-sm sm:grid-cols-2" aria-labelledby="other-h">
        <h2 id="other-h" className="col-span-full text-[22px] font-bold">{L("حقوق تانية", "Other credits")}</h2>
        <p className="sf-card p-4" dir="ltr" lang="en">Crowd illustrations: <a className="text-primary hover:underline" href="https://www.openpeeps.com/" target="_blank" rel="noopener noreferrer">Open Peeps</a> by Pablo Stanley (CC0). Crowd canvas adapted from Skiper UI “Skiper 39” by @gurvinder-singh02, inspired by Zadvorsky's CodePen.</p>
        <p className="sf-card p-4" dir="ltr" lang="en">Fonts: Reem Kufi, IBM Plex Sans Arabic and IBM Plex Mono (SIL Open Font License) via Google Fonts. Icons: Lucide (ISC). Avatars: blobatar.</p>
      </section>
    </div>
  );
}

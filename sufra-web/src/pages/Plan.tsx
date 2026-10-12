import { useEffect, useMemo, useRef, useState } from "react";
import { Blobatar } from "@blobatar/react";
import { Check, Copy, Crown, Send } from "lucide-react";
import { GroupChat } from "@/components/ui/group-chat";
import { BookingDialog } from "@/components/sufra/BookingDialog";
import { Distance, OpenBadge, Ratings } from "@/components/sufra/bits";
import { Photo } from "@/components/sufra/Photo";
import { areaName, bySlug, byId, cuisineName, restaurants } from "@/lib/data";
import { useNow } from "@/lib/hooks";
import { useLang } from "@/lib/i18n";
import { copyText } from "@/lib/copy";
import { notify } from "@/lib/notify";
import { navigate, shareUrl, type Route } from "@/lib/router";
import { updateAccount, useAccount, type Plan as PlanT } from "@/lib/store";
import { cn } from "@/lib/utils";

const FRIENDS = ["مريم", "كريم", "نور"];
const hhmm = (d = new Date()) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

export default function Plan({ id, route }: { id: string; route: Route }) {
  const { L, lang } = useLang();
  const acc = useAccount();
  const now = useNow(15_000);

  // "new" creates a room from ?r=slug (+ 2 similar places), then redirects to it
  const created = useRef(false);
  useEffect(() => {
    if (id !== "new" || !acc || created.current) return;
    created.current = true;
    const base = bySlug[route.query.get("r") ?? ""] ?? [...restaurants].sort((a, b) => b.rating - a.rating)[3];
    const others = restaurants
      .filter((r) => r.id !== base.id && r.moods.includes("friends"))
      .sort((a, b) => (a.area === base.area ? -1 : 0) - (b.area === base.area ? -1 : 0) || b.rating - a.rating)
      .slice(0, 2);
    const me = acc.profile.name.split(" ")[0];
    const plan: PlanT = {
      id: "p-" + Date.now().toString(36),
      title: L("خروجة الخميس", "Thursday night out"),
      when: L("الخميس الجاي · 9 م", "Next Thursday · 9 PM"),
      candidates: [base.id, ...others.map((o) => o.id)],
      votes: {},
      members: [me, ...FRIENDS],
      messages: [{ name: me, text: L("يا جماعة رشحتلكم 3 أماكن، صوّتوا!", "Folks, I shortlisted 3 places — vote!"), time: hhmm() }],
      createdAt: Date.now(),
    };
    updateAccount((a) => ({ ...a, plans: [plan, ...a.plans] }));
    navigate(`/plan/${plan.id}`, { replace: true });
  }, [id, acc, route.query, L]);

  const plan = acc?.plans.find((p) => p.id === id);
  const me = acc?.profile.name.split(" ")[0] ?? "";
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState<string | undefined>();
  const [bookOpen, setBookOpen] = useState(false);

  const patch = (fn: (p: PlanT) => PlanT) => updateAccount((a) => ({ ...a, plans: a.plans.map((p) => (p.id === id ? fn(p) : p)) }));

  // friends join the conversation and vote over time (simulated)
  useEffect(() => {
    if (!plan) return;
    const pending = FRIENDS.filter((f) => !plan.votes[f]);
    if (!pending.length) return;
    const who = pending[0];
    const t1 = window.setTimeout(() => setTyping(who), 1800);
    const t2 = window.setTimeout(() => {
      setTyping(undefined);
      // friends lean towards the best-rated candidate, with a little taste
      const ranked = [...plan.candidates].sort((a, b) => byId[b].rating - byId[a].rating);
      const pick = ranked[(who.length + Object.keys(plan.votes).length) % 2];
      const lines = {
        مريم: [L(`أنا مع ${byId[pick].ar}، القعدة هناك حلوة`, `I'm in for ${byId[pick].en}, great vibe`)],
        كريم: [L(`${byId[pick].ar} يا عم، الأكل هناك تحفة`, `${byId[pick].en}, the food's amazing`), L("بس متتأخروش", "Just don't be late")],
        نور: [L(`صوتت لـ ${byId[pick].ar} — قريب مني كمان`, `Voted ${byId[pick].en} — it's close to me too`)],
      } as Record<string, string[]>;
      patch((p) => ({
        ...p,
        votes: { ...p.votes, [who]: pick },
        messages: [...p.messages, ...(lines[who] ?? []).map((text) => ({ name: who, text, time: hhmm() }))],
      }));
      notify({ title: L(`${who} صوّت`, `${who} voted`), detail: byId[pick][lang], icon: "bell", ttl: 3000 });
    }, 4200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.votes, plan?.id]);

  const tally = useMemo(() => {
    const m: Record<string, number> = {};
    plan?.candidates.forEach((c) => (m[c] = 0));
    Object.values(plan?.votes ?? {}).forEach((v) => (m[v] = (m[v] ?? 0) + 1));
    return m;
  }, [plan]);

  if (!acc) {
    return (
      <div className="wrap gutter grid min-h-[50vh] place-items-center text-center">
        <div>
          <p className="font-display text-3xl font-bold">{L("سجّل دخول عشان تخطط مع صحابك", "Sign in to plan with friends")}</p>
          <a href="#/account" className="sf-btn sf-btn-primary mt-5">{L("تسجيل الدخول", "Sign in")}</a>
        </div>
      </div>
    );
  }
  if (!plan) return <div className="wrap gutter min-h-[50vh] py-16 text-center text-muted-foreground">{L("بنجهز الأوضة…", "Setting up the room…")}</div>;

  const leader = plan.candidates.reduce((a, b) => (tally[b] > tally[a] ? b : a), plan.candidates[0]);
  const totalVotes = Object.keys(plan.votes).length;
  const winner = byId[leader];
  const link = shareUrl(`/plan/${plan.id}`);

  return (
    <div className="wrap gutter pb-16 pt-6">
      <p className="sf-kicker">{L("خروجة مع الأصحاب", "Plan with friends")}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-bold sm:text-[44px]">{plan.title}</h1>
          <p className="text-muted-foreground">{plan.when} · {L(`${plan.members.length} أفراد`, `${plan.members.length} people`)}</p>
        </div>
        <button
          type="button"
          className="sf-btn sf-btn-ghost bg-card"
          onClick={async () => {
            const ok = await copyText(link);
            notify({ title: ok ? L("لينك الأوضة اتنسخ", "Room link copied") : link, detail: L("ابعته على جروب الواتساب.", "Drop it in the group chat."), ttl: 3000 });
          }}
        >
          <Copy className="size-4" aria-hidden />
          {L("انسخ لينك الدعوة", "Copy invite link")}
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <section aria-labelledby="vote-h">
          <h2 id="vote-h" className="text-xl font-bold">{L("صوّت على المكان", "Vote for the place")}</h2>
          <ul className="mt-3 grid gap-3">
            {plan.candidates.map((cid) => {
              const r = byId[cid];
              const votes = tally[cid] ?? 0;
              const mine = plan.votes[me] === cid;
              const voters = Object.entries(plan.votes).filter(([, v]) => v === cid).map(([k]) => k);
              return (
                <li key={cid} className={cn("rounded-2xl border bg-card p-3 transition-colors", mine && "border-primary", cid === leader && totalVotes > 0 && "ring-2 ring-brass/50")}>
                  <div className="flex gap-3">
                    <Photo k={r.cover} label={r[lang]} className="size-24 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <a href={`#/r/${r.slug}`} className="font-display text-lg font-semibold hover:underline">{r[lang]}</a>
                        {cid === leader && totalVotes > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-brass px-2 py-0.5 text-[11px] font-bold text-brass-ink"><Crown className="size-3" aria-hidden />{L("في المقدمة", "Leading")}</span> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{cuisineName(r.cuisine, lang)} · {areaName(r.area, lang)} · <span className="num">{r.avg}</span> {L("ج.م للفرد", "EGP pp")}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <Ratings r={r} />
                        <OpenBadge r={r} now={now} />
                      </div>
                      <Distance r={r} compact className="mt-1" />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${(votes / plan.members.length) * 100}%` }} />
                    </div>
                    <div className="flex">
                      {voters.map((v) => <Blobatar key={v} name={v} animate="hover" background="circle" className="-ms-1.5 size-6 rounded-full ring-2 ring-card first:ms-0" title={v} />)}
                    </div>
                    <span className="num w-10 text-end text-sm font-semibold">{votes}</span>
                    <button
                      type="button"
                      aria-pressed={mine}
                      onClick={() => patch((p) => ({ ...p, votes: { ...p.votes, [me]: cid }, messages: [...p.messages, { name: me, text: L(`صوّت لـ ${r.ar}`, `Voted for ${r.en}`), time: hhmm() }] }))}
                      className={cn("inline-flex h-9 items-center gap-1 rounded-full px-4 text-sm font-semibold", mine ? "bg-primary text-primary-foreground" : "border bg-background")}
                    >
                      {mine ? <Check className="size-4" aria-hidden /> : null}
                      {mine ? L("صوتّك", "Your vote") : L("صوّت", "Vote")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary-soft p-4">
            <p className="text-sm">
              <span className="num font-semibold">{totalVotes}/{plan.members.length}</span> {L("صوّتوا. المكسب لحد دلوقتي:", "voted. Leading:")} <span className="font-semibold">{winner[lang]}</span>
            </p>
            <button type="button" className="sf-btn sf-btn-primary sf-btn-sm" onClick={() => setBookOpen(true)}>
              {L(`احجز في ${winner.ar}`, `Book ${winner.en}`)}
            </button>
          </div>
        </section>

        <GroupChat
          messages={plan.messages}
          channel={plan.title.replace(/\s+/g, "-")}
          members={plan.members}
          extra={0}
          typing={typing}
          typingLabel={(n) => L(`${n} بيكتب`, `${n} is typing`)}
          className="self-start"
        >
          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              patch((p) => ({ ...p, messages: [...p.messages, { name: me, text: draft.trim(), time: hhmm() }] }));
              setDraft("");
            }}
          >
            <label className="flex-1">
              <span className="sr-only">{L("رسالة", "Message")}</span>
              <input className="sf-input h-11 rounded-full" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={L("اكتب للشلة…", "Message the group…")} />
            </label>
            <button type="submit" className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground" aria-label={L("ابعت", "Send")}>
              <Send className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          </form>
        </GroupChat>
      </div>
      <BookingDialog r={winner} open={bookOpen} onClose={() => setBookOpen(false)} />
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Cake, Coins, Gift, Heart, MapPin, MessageCircle, Pencil, Phone, Plus, ReceiptText, Share2, Star, Stamp, Tag, Ticket, X } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive, useRow } from "@/data/hooks";
import type { Consent, Customer } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { ago, dayLabel } from "@/lib/time";
import { computeBalance, nextTier } from "@/lib/promo";
import { clickToChatUrl } from "@/lib/notify/core";
import { Avatar, Badge, Button, Dialog, EmptyState, Input, Meter, Money, Skeleton, StatTile, Switch, Textarea, useToast } from "@/ui";
import { refreshLoyalty } from "@/modules/marketing/ops";
import { RfmBadge, Section, SOURCE_LABEL, Stars, TierBadge } from "@/modules/marketing/ui";
import { useCrm } from "./useCrm";
import { NO_CONSENT } from "./crm";

export default function CustomerProfile() {
  const { customerId = "" } = useParams();
  const { L, lang, loc } = useT();
  const db = useDb();
  const { can } = useSession();
  const { toast } = useToast();
  const crm = useCrm();
  const { data: c, loading } = useRow("customers", customerId);
  const ledger = useLive("loyaltyLedger", { where: { customerId }, orderBy: [{ field: "at", dir: "desc" }] }).data;
  const orders = useLive("orders", { where: { customerId }, orderBy: [{ field: "openedAt", dir: "desc" }] }).data;
  const checks = useLive("checks", { where: { customerId } }).data;
  const reds = useLive("promoRedemptions", { where: { customerId }, orderBy: [{ field: "at", dir: "desc" }] }).data;
  const codes = useLive("couponCodes", { where: { customerId } }).data;
  const promos = useLive("promotions").data;
  const feedback = useLive("guestFeedback", { where: { customerId }, orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const refs = useLive("referrals", { where: { referrerId: customerId } }).data;
  const msgs = useLive("campaignMessages", { where: { customerId }, orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const menu = useLive("menuItems").data;
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);

  const stats = crm.statsOf(customerId);
  const tier = c ? crm.tierOf(c) : null;
  const balance = useMemo(() => computeBalance(ledger.map((e) => ({ id: e.id, kind: e.kind, points: e.points, at: e.at, expiresAt: e.expiresAt }))), [ledger]);
  const next = c ? nextTier(c.lifetimePoints ?? balance.lifetime, crm.rules.tiers) : null;
  const visits = ledger.filter((e) => e.kind === "earn");
  const favourites = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of visits) for (const [k, n] of Object.entries(v.items ?? {})) m.set(k, (m.get(k) ?? 0) + n);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ item: menu.find((x) => x.id === id), n }));
  }, [visits, menu]);

  if (loading && !c) return <Skeleton className="h-96" rounded="rounded-[20px]" />;
  if (!c) return <EmptyState icon={<X />} title={L("الزبون مش موجود", "Customer not found")} action={<Link to="/customers" className="font-semibold text-primary">{L("كل الزباين", "All customers")}</Link>} />;

  const avg = c.visits ? Math.round(c.totalSpent / c.visits) : 0;
  const wa = clickToChatUrl(c.phone, L(`أهلًا ${c.name.split(" ")[0]} 👋`, `Hi ${c.name.split(" ")[0]} 👋`));
  const stampCards = crm.rules.stampCards.filter((s) => s.active);

  return (
    <div className="grid gap-5">
      <Link to="/customers" className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4 flip-rtl" /> {L("كل الزباين", "All customers")}
      </Link>

      <section className="relative overflow-hidden rounded-[24px] border border-line bg-surface p-5 shadow-sf-sm">
        <div className="absolute inset-y-0 end-0 w-1/2 opacity-[0.07]" style={{ background: `radial-gradient(circle at 80% 20%, ${tier?.color ?? "var(--sf-primary)"}, transparent 60%)` }} />
        <div className="relative flex flex-wrap items-start gap-4">
          <Avatar name={c.name} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[24px] leading-tight">{c.name}</h2>
              <TierBadge tier={tier} />
              <RfmBadge segment={stats?.rfm} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-muted">
              <a href={`tel:${c.phone}`} className="num inline-flex items-center gap-1.5 hover:text-ink" dir="ltr">
                <Phone className="size-3.5" /> {c.phone}
              </a>
              {c.email ? <span dir="ltr">{c.email}</span> : null}
              {c.birthday ? (
                <span className="inline-flex items-center gap-1.5">
                  <Cake className="size-3.5" /> {dayLabel(`${c.birthday}T12:00:00Z`, lang)}
                </span>
              ) : null}
              {c.source ? <span>{L("من", "via")} {loc(SOURCE_LABEL[c.source])}</span> : null}
              <span>{L("عميل من", "since")} {dayLabel(c.createdAt, lang)}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.tags.map((t) => (
                <Badge key={t} size="sm" icon={<Tag className="size-3" />}>{t}</Badge>
              ))}
              {c.allergies ? <Badge size="sm" tone="danger">{L("حساسية", "Allergy")}: {c.allergies}</Badge> : null}
              {c.consent?.whatsapp ? <Badge size="sm" tone="ok">WhatsApp ✓</Badge> : <Badge size="sm" tone="warn">{L("مش موافق على واتساب", "No WhatsApp consent")}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1fa855] px-4 font-semibold text-white">
              <MessageCircle className="size-5" /> {L("واتساب", "WhatsApp")}
            </a>
            {can("customers.edit") ? (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
                {L("تعديل", "Edit")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile index={0} label={L("زيارات", "Visits")} value={c.visits} sub={c.lastVisitAt ? L(`آخر زيارة ${ago(c.lastVisitAt, "ar")}`, `last ${ago(c.lastVisitAt, "en")}`) : L("لسه مازارش", "No visit yet")} />
        <StatTile index={1} tone="ok" label={L("إجمالي الصرف (LTV)", "Lifetime value")} value={formatMoney(c.totalSpent, { lang, whole: true })} />
        <StatTile index={2} tone="info" label={L("متوسط الشيك", "Avg spend")} value={formatMoney(avg, { lang, whole: true })} />
        <StatTile index={3} tone="brass" icon={<Coins />} label={L("النقاط", "Points")} value={c.loyaltyPoints.toLocaleString("en")} sub={formatMoney(c.loyaltyPoints * crm.rules.pointValue, { lang })} />
        <StatTile index={4} tone="warn" label={L("كوبونات", "Coupons")} value={codes.filter((x) => !x.usedAt).length} sub={L(`${reds.filter((r) => r.status === "redeemed").length} استخدام`, `${reds.filter((r) => r.status === "redeemed").length} used`)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Section title={L("الزيارات والطلبات", "Visits & orders")} icon={<ReceiptText />} subtitle={L(`${visits.length} زيارة مسجلة`, `${visits.length} recorded visits`)}>
            {visits.length || orders.length ? (
              <ol className="relative grid gap-0.5 border-s border-line ps-4">
                {orders.slice(0, 5).map((o) => {
                  const ch = checks.find((x) => x.id === o.checkId);
                  return (
                    <li key={o.id} className="relative py-2">
                      <span className="absolute -start-[21px] top-3.5 size-2.5 rounded-full bg-primary ring-4 ring-surface" />
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-semibold">#{o.number} · {o.mode === "delivery" ? L("دليفري", "Delivery") : o.mode === "takeaway" ? L("تيك أواي", "Takeaway") : L("صالة", "Dine-in")}</span>
                        {ch ? <Money value={ch.total} className="font-semibold" /> : null}
                      </div>
                      <p className="text-[12.5px] text-muted">{dayLabel(o.openedAt, lang)} · {o.status}</p>
                    </li>
                  );
                })}
                {visits.slice(0, 12).map((v) => (
                  <li key={v.id} className="relative py-2">
                    <span className="absolute -start-[21px] top-3.5 size-2.5 rounded-full bg-line-strong ring-4 ring-surface" />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[14px] font-semibold">
                        {dayLabel(v.at, lang)}
                        <span className="ms-2 text-[12.5px] font-normal text-muted">{Object.keys(v.items ?? {}).map((k) => loc(menu.find((m) => m.id === k)?.name)).filter(Boolean).join("، ")}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Money value={v.spend} className="text-[14px]" />
                        {v.points ? <Badge tone="brass" size="sm">+{v.points}</Badge> : null}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState compact title={L("لسه مفيش زيارات", "No visits yet")} body={L("عميل محتمل — ابعتله عرض ترحيب", "A lead — send a welcome offer")} />
            )}
          </Section>

          <Section title={L("النقاط", "Points history")} icon={<Coins />} action={can("customers.edit") ? <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdjust(true)}>{L("تعديل نقاط", "Adjust")}</Button> : null}>
            <div className="mb-4 grid gap-2 rounded-2xl bg-surface-2 p-4">
              <div className="flex items-center justify-between text-[13.5px]">
                <span className="font-semibold">{tier ? loc(tier.name) : "—"}</span>
                <span className="text-muted">{next ? L(`باقي ${next.missing} نقطة على ${next.tier.name.ar}`, `${next.missing} points to ${next.tier.name.en}`) : L("أعلى مستوى", "Top tier")}</span>
              </div>
              <Meter value={next ? (c.lifetimePoints ?? 0) / next.tier.minPoints : 1} tone="brass" label={L("التقدم للمستوى الجاي", "Progress to next tier")} />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                <span>{L("اتكسب", "Earned")} <b className="num text-ink">{balance.lifetime}</b></span>
                <span>{L("اتصرف", "Redeemed")} <b className="num text-ink">{balance.redeemed}</b></span>
                <span>{L("انتهى", "Expired")} <b className="num text-ink">{balance.expired}</b></span>
                {balance.expiringSoon ? <span className="text-warn">{L(`${balance.expiringSoon.points} نقطة هتنتهي ${dayLabel(balance.expiringSoon.at, "ar")}`, `${balance.expiringSoon.points} expire ${dayLabel(balance.expiringSoon.at, "en")}`)}</span> : null}
              </div>
            </div>
            <ul className="grid max-h-72 gap-1 overflow-y-auto text-[13.5px] thin-scrollbar">
              {ledger.filter((e) => e.points !== 0).slice(0, 40).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                  <span>
                    <Badge size="sm" tone={e.points > 0 ? "ok" : e.kind === "expire" ? "warn" : "info"}>{e.kind}</Badge>
                    <span className="ms-2 text-muted">{dayLabel(e.at, lang)}{e.note ? ` · ${e.note}` : ""}</span>
                  </span>
                  <span className={`num font-semibold ${e.points > 0 ? "text-ok" : "text-muted"}`}>{e.points > 0 ? "+" : ""}{e.points}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={L("التقييمات", "Feedback")} icon={<Star />}>
            {feedback.length ? (
              <ul className="grid gap-3">
                {feedback.map((f) => (
                  <li key={f.id} className="rounded-2xl border border-line p-3">
                    <div className="flex items-center justify-between">
                      <Stars value={f.stars} />
                      <span className="text-[12.5px] text-muted">{dayLabel(f.createdAt, lang)}</span>
                    </div>
                    {f.comment ? <p className="mt-1.5 text-[14px]">“{f.comment}”</p> : null}
                    {f.reply ? <p className="mt-1.5 rounded-xl bg-primary-soft px-3 py-2 text-[13px] text-primary">↩ {f.reply}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted">{L("مفيش تقييمات لسه", "No feedback yet")}</p>
            )}
          </Section>
        </div>

        <div className="grid content-start gap-5">
          <Section title={L("الأكل المفضل", "Favourite items")} icon={<Heart />}>
            {favourites.length ? (
              <ul className="grid grid-cols-2 gap-2">
                {favourites.map(({ item, n }) => (
                  <li key={item?.id ?? n} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-[13.5px]">
                    <span className="truncate font-semibold">{loc(item?.name)}</span>
                    <span className="num text-muted">×{n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted">—</p>
            )}
          </Section>

          {stampCards.length ? (
            <Section title={L("كروت الأختام", "Stamp cards")} icon={<Stamp />}>
              {stampCards.map((s) => {
                const have = c.stamps?.[s.id] ?? 0;
                return (
                  <div key={s.id} className="grid gap-2">
                    <p className="text-[13.5px] font-semibold">{loc(s.name)}</p>
                    <div className="flex flex-wrap gap-1.5" aria-label={`${have}/${s.required}`}>
                      {Array.from({ length: s.required }, (_, i) => (
                        <span key={i} className={`grid size-8 place-items-center rounded-full border-2 text-[12px] ${i < have ? "border-brass bg-brass text-brass-ink" : "border-dashed border-line-strong text-faint"}`}>{i === s.required - 1 ? "🎁" : i < have ? "✓" : ""}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </Section>
          ) : null}

          <Section title={L("الكوبونات والعروض", "Coupons & offers")} icon={<Ticket />}>
            <ul className="grid gap-2 text-[13.5px]">
              {codes.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="num font-semibold" dir="ltr">{x.code}</span>
                    <span className="ms-2 truncate text-muted">{loc(promos.find((p) => p.id === x.promotionId)?.name)}</span>
                  </span>
                  {x.usedAt ? <Badge size="sm" tone="ok">{L("اتستخدم", "Used")}</Badge> : <Badge size="sm" tone="brass">{L("متاح", "Open")}</Badge>}
                </li>
              ))}
              {reds.filter((r) => !codes.some((x) => x.code === r.code)).slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{loc(promos.find((p) => p.id === r.promotionId)?.name) || r.rewardId}</span>
                  <Money value={-(r.discount + r.deliveryDiscount)} className="text-muted" />
                </li>
              ))}
              {!codes.length && !reds.length ? <li className="text-muted">—</li> : null}
            </ul>
          </Section>

          <Section title={L("التواصل والموافقات", "Contact & consent")} icon={<MessageCircle />}>
            <dl className="grid gap-1.5 text-[13.5px]">
              {(["whatsapp", "sms", "email", "push"] as const).map((k) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-muted">{k}</dt>
                  <dd>{c.consent?.[k] ? <Badge size="sm" tone="ok">✓</Badge> : <Badge size="sm">✗</Badge>}</dd>
                </div>
              ))}
              {c.consent?.at ? <p className="mt-1 text-[12px] text-faint">{L("اتسجلت", "Recorded")} {dayLabel(c.consent.at, lang)} · {c.consent.via}</p> : null}
            </dl>
            {msgs.length ? (
              <>
                <p className="mt-4 mb-1.5 text-[12.5px] font-semibold text-muted">{L("آخر الرسايل", "Recent messages")}</p>
                <ul className="grid gap-1.5 text-[13px]">
                  {msgs.slice(0, 4).map((m) => (
                    <li key={m.id} className="rounded-xl bg-surface-2 px-3 py-2">
                      <p className="line-clamp-2">{m.text}</p>
                      <p className="mt-1 text-[11.5px] text-muted">{m.status}{m.redeemedAt ? ` · ✓ ${L("استخدم العرض", "redeemed")}` : ""}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Section>

          <Section title={L("العناوين", "Addresses")} icon={<MapPin />}>
            {c.addresses.length ? (
              <ul className="grid gap-2 text-[13.5px]">
                {c.addresses.map((a, i) => (
                  <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                    <b>{a.area}</b> — {a.address}
                    {a.notes ? <span className="block text-muted">{a.notes}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted">—</p>
            )}
          </Section>

          <Section title={L("ترشيح الأصحاب", "Referrals")} icon={<Share2 />}>
            <p className="text-[13.5px]">
              {L("كود الترشيح", "Referral code")}: <b className="num" dir="ltr">{c.referralCode ?? "—"}</b>
            </p>
            <p className="mt-1 text-[12.5px] text-muted">{L(`رشّح ${refs.length} · اتكافأ على ${refs.filter((r) => r.status === "rewarded").length}`, `Referred ${refs.length} · rewarded ${refs.filter((r) => r.status === "rewarded").length}`)}</p>
          </Section>

          <Section title={L("ملاحظات", "Notes")} icon={<Gift />}>
            <p className="whitespace-pre-wrap text-[14px]">{c.notes || <span className="text-muted">—</span>}</p>
          </Section>
        </div>
      </div>

      <EditCustomer open={edit} onClose={() => setEdit(false)} c={c} />
      <AdjustPoints
        open={adjust}
        onClose={() => setAdjust(false)}
        onSave={async (points, note) => {
          await db.insert("loyaltyLedger", { customerId: c.id, branchId: db.branchId, kind: "adjust", points, spend: 0, checkId: null, channel: null, rewardId: null, stamps: {}, expiresAt: null, note, actorId: db.actorId, at: new Date().toISOString() });
          await db.audit("loyalty.adjust", "customers", c.id, { points, note });
          await refreshLoyalty(db, (await db.get("customers", c.id))!, crm.program);
          toast({ title: L("النقاط اتعدّلت", "Points adjusted"), tone: "success" });
          setAdjust(false);
        }}
      />
    </div>
  );
}

function EditCustomer({ open, onClose, c }: { open: boolean; onClose: () => void; c: Customer }) {
  const { L } = useT();
  const db = useDb();
  const [f, setF] = useState(() => ({ name: c.name, email: c.email ?? "", birthday: c.birthday ?? "", tags: c.tags.join("، "), notes: c.notes, allergies: c.allergies ?? "", consent: c.consent ?? NO_CONSENT }));
  const setConsent = (k: keyof Consent, v: boolean) => setF((x) => ({ ...x, consent: { ...x.consent, [k]: v, at: new Date().toISOString(), via: "staff" } }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={L("تعديل الزبون", "Edit customer")}
      footer={
        <Button block size="lg" onClick={async () => {
          await db.update("customers", c.id, { name: f.name.trim() || c.name, email: f.email || null, birthday: f.birthday || null, tags: f.tags.split(/[،,]/).map((t) => t.trim()).filter(Boolean), notes: f.notes, allergies: f.allergies, consent: f.consent });
          await db.audit("customer.edit", "customers", c.id, {});
          onClose();
        }}>
          {L("حفظ", "Save")}
        </Button>
      }
    >
      <div className="grid gap-3 pb-1 sm:grid-cols-2">
        <Input label={L("الاسم", "Name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label={L("الإيميل", "Email")} dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label={L("عيد الميلاد", "Birthday")} type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} />
        <Input label={L("تاجز (افصل بفاصلة)", "Tags (comma separated)")} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
        <Input label={L("حساسية", "Allergies")} value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} wrapClassName="sm:col-span-2" />
        <div className="sm:col-span-2">
          <Textarea label={L("ملاحظات", "Notes")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
        <div className="grid gap-1 rounded-2xl bg-surface-2 px-4 py-2 sm:col-span-2">
          <Switch checked={f.consent.whatsapp} onChange={(v) => setConsent("whatsapp", v)} label={L("موافق على واتساب", "WhatsApp consent")} />
          <Switch checked={f.consent.sms} onChange={(v) => setConsent("sms", v)} label={L("موافق على SMS", "SMS consent")} />
          <Switch checked={f.consent.email} onChange={(v) => setConsent("email", v)} label={L("موافق على الإيميل", "Email consent")} />
        </div>
      </div>
    </Dialog>
  );
}

function AdjustPoints({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (points: number, note: string) => void }) {
  const { L } = useT();
  const [n, setN] = useState("");
  const [note, setNote] = useState("");
  const v = Math.round(Number(n.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))) || 0);
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={L("تعديل النقاط", "Adjust points")} footer={<Button block disabled={!v || !note.trim()} onClick={() => onSave(v, note.trim())}>{L("حفظ", "Save")}</Button>}>
      <div className="grid gap-3 pb-1">
        <Input label={L("النقاط (+ أو −)", "Points (+ or −)")} dir="ltr" value={n} onChange={(e) => setN(e.target.value)} placeholder="+100 / -50" />
        <Input label={L("السبب", "Reason")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L("تعويض عن تأخير", "Compensation for a delay")} />
      </div>
    </Dialog>
  );
}

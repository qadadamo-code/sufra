import { useEffect, useMemo, useState } from "react";
import { Coins, Crown, Gift, Plus, Save, Stamp, Trash2, Wallet } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { LoyaltyProgram } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, major, sumUnits } from "@/lib/money";
import { pointsFor, type Reward, type StampCard, type Tier } from "@/lib/promo";
import { Badge, Button, IconButton, Select, Switch, useToast } from "@/ui";
import { DEFAULT_RULES } from "./ops";
import { LocalizedInput, MoneyInput, NumberInput, Section, TierBadge } from "./ui";

export default function LoyaltyPage() {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { can } = useSession();
  const { toast } = useToast();
  const saved = useLive("loyaltyPrograms").data[0] ?? null;
  const customers = useLive("customers").data;
  const menu = useLive("menuItems", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const cats = useLive("menuCategories", { orderBy: [{ field: "sort" }] }).data;
  const [p, setP] = useState<Omit<LoyaltyProgram, "id" | "restaurantId" | "createdAt" | "updatedAt"> | null>(null);
  useEffect(() => {
    if (!p) setP(saved ? { ...saved } : { ...DEFAULT_RULES, name: { ar: "نادي الولاء", en: "Loyalty club" }, referralPromotionId: null, referralMonthlyCap: 10, terms: { ar: "", en: "" } });
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = can("marketing.manage");
  const liability = useMemo(() => sumUnits(customers.map((c) => c.loyaltyPoints)) * (p?.pointValue ?? 0), [customers, p?.pointValue]);
  if (!p) return null;
  const set = (x: Partial<typeof p>) => setP({ ...p, ...x });
  const backPct = p.earnSpend ? ((p.earnPoints * p.pointValue) / p.earnSpend) * 100 : 0;

  const save = async () => {
    if (saved) await db.update("loyaltyPrograms", saved.id, p);
    else await db.insert("loyaltyPrograms", p);
    await db.audit("loyalty.settings", "loyaltyPrograms", saved?.id ?? null, {});
    toast({ title: L("إعدادات الولاء اتحفظت", "Loyalty settings saved"), tone: "success" });
  };
  const tierRow = (t: Tier, i: number) => (
    <li key={t.id} className="grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-[auto_minmax(0,1.2fr)_repeat(2,minmax(0,0.7fr))_auto] sm:items-end">
      <input type="color" aria-label={L("اللون", "Colour")} value={t.color} onChange={(e) => set({ tiers: p.tiers.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} className="h-11 w-12 cursor-pointer rounded-xl border border-line bg-surface p-1" />
      <LocalizedInput label={L("الاسم", "Name")} value={t.name} onChange={(v) => set({ tiers: p.tiers.map((x, j) => (j === i ? { ...x, name: v } : x)) })} />
      <NumberInput label={L("من نقطة (تراكمي)", "From (lifetime pts)")} value={t.minPoints} onChange={(n) => set({ tiers: p.tiers.map((x, j) => (j === i ? { ...x, minPoints: n } : x)) })} />
      <NumberInput label={L("مضاعف النقاط", "Multiplier")} step={0.05} value={t.multiplier / 10_000} suffix="×" onChange={(n) => set({ tiers: p.tiers.map((x, j) => (j === i ? { ...x, multiplier: Math.round(n * 10_000) } : x)) })} />
      <IconButton label={L("امسح المستوى", "Remove tier")} onClick={() => set({ tiers: p.tiers.filter((_, j) => j !== i) })} disabled={p.tiers.length <= 1}>
        <Trash2 />
      </IconButton>
      <div className="sm:col-span-5">
        <LocalizedInput label={L("المميزات (سطر لكل ميزة)", "Perks (one per line)")} multiline value={{ ar: t.perks.map((x) => x.ar).join("\n"), en: t.perks.map((x) => x.en).join("\n") }} onChange={(v) => {
          const ar = v.ar.split("\n");
          const en = v.en.split("\n");
          set({ tiers: p.tiers.map((x, j) => (j === i ? { ...x, perks: Array.from({ length: Math.max(ar.length, en.length) }, (_, k) => ({ ar: ar[k] ?? "", en: en[k] ?? "" })) } : x)) });
        }} />
      </div>
    </li>
  );

  return (
    <div className="grid gap-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title={L("البرنامج", "Program")} icon={<Coins />} action={editable ? <Button icon={<Save className="size-4" />} onClick={save}>{L("احفظ", "Save")}</Button> : null}>
          <div className="grid gap-4">
            <Switch checked={p.enabled} onChange={(v) => set({ enabled: v })} label={L("برنامج الولاء شغّال", "Loyalty program on")} description={L("الكاشير والطلب أونلاين بيكسبوا ويصرفوا نقاط", "POS and online orders earn and redeem points")} />
            <LocalizedInput label={L("اسم البرنامج", "Program name")} value={p.name} onChange={(v) => set({ name: v })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberInput label={L("نقاط", "Points")} value={p.earnPoints} onChange={(n) => set({ earnPoints: Math.round(n) })} hint={L("بتتكسب على كل…", "earned for every…")} />
              <MoneyInput label={L("صرف", "Spend")} value={p.earnSpend} onChange={(u) => set({ earnSpend: u })} hint={L("قبل الضريبة والخدمة", "before VAT and service")} />
              <MoneyInput label={L("قيمة النقطة", "Point value")} value={p.pointValue} onChange={(u) => set({ pointValue: u })} hint={L(`يعني ${backPct.toFixed(1)}٪ راجعين للزبون`, `= ${backPct.toFixed(1)}% back to the guest`)} />
              <NumberInput label={L("أقل صرف للنقاط", "Minimum redemption")} value={p.minRedeem} suffix={L("نقطة", "pts")} onChange={(n) => set({ minRedeem: Math.round(n) })} />
              <NumberInput label={L("النقاط بتنتهي بعد", "Points expire after")} value={p.expiryDays ?? 0} suffix={L("يوم", "days")} hint={L("٠ = مابتنتهيش", "0 = never")} onChange={(n) => set({ expiryDays: n ? Math.round(n) : null })} />
              <NumberInput label={L("هدية الترحيب", "Welcome bonus")} value={p.welcomeBonus} suffix={L("نقطة", "pts")} onChange={(n) => set({ welcomeBonus: Math.round(n) })} />
              <NumberInput label={L("هدية عيد الميلاد", "Birthday bonus")} value={p.birthdayBonus} suffix={L("نقطة", "pts")} onChange={(n) => set({ birthdayBonus: Math.round(n) })} />
              <NumberInput label={L("مكافأة ترشيح صاحب", "Referral reward")} value={p.referrerPoints} suffix={L("نقطة", "pts")} onChange={(n) => set({ referrerPoints: Math.round(n) })} />
              <NumberInput label={L("حد الترشيحات في الشهر", "Referrals per month")} value={p.referralMonthlyCap} onChange={(n) => set({ referralMonthlyCap: Math.round(n) })} />
            </div>
            <div className="grid gap-2">
              <span className="text-[13px] font-semibold text-ink-2">{L("أقسام مابتكسبش نقاط", "Categories that don't earn")}</span>
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => {
                  const on = p.excludedCategoryIds.includes(c.id);
                  return (
                    <button key={c.id} type="button" aria-pressed={on} onClick={() => set({ excludedCategoryIds: on ? p.excludedCategoryIds.filter((x) => x !== c.id) : [...p.excludedCategoryIds, c.id] })} className={`h-9 rounded-full border px-3 text-[13px] font-semibold ${on ? "border-danger/40 bg-danger-soft text-danger" : "border-line hover:bg-surface-2"}`}>
                      {loc(c.name)}
                    </button>
                  );
                })}
              </div>
            </div>
            <LocalizedInput label={L("الشروط (بتظهر للزبون)", "Terms (shown to guests)")} multiline value={p.terms} onChange={(v) => set({ terms: v })} />
          </div>
        </Section>

        <div className="grid content-start gap-5">
          <Section title={L("ازاي بيشتغل", "How it works")} icon={<Wallet />}>
            <ul className="grid gap-2 text-[14px]">
              {[major(250), major(800), major(2000)].map((s) => (
                <li key={s} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2">
                  <span>{L("شيك", "A bill of")} <b>{formatMoney(s, { lang, whole: true })}</b></span>
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {p.tiers.map((t) => (
                      <Badge key={t.id} size="sm" tone="brass">{loc(t.name)} +{pointsFor(s, p, t)}</Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-muted">{L(`${p.minRedeem} نقطة = ${formatMoney(p.minRedeem * p.pointValue, { lang })} خصم`, `${p.minRedeem} points = ${formatMoney(p.minRedeem * p.pointValue, { lang })} off`)}</p>
          </Section>
          <Section title={L("التزام النقاط", "Points liability")} icon={<Coins />} subtitle={L("قيمة النقاط اللي مع الزباين لو اتصرفت كلها", "Value of all outstanding points if redeemed")}>
            <p className="num font-display text-[34px] font-semibold">{formatMoney(liability, { lang, whole: true })}</p>
            <p className="text-[13px] text-muted">{L(`${sumUnits(customers.map((c) => c.loyaltyPoints)).toLocaleString("en")} نقطة عند ${customers.filter((c) => c.loyaltyPoints > 0).length} زبون`, `${sumUnits(customers.map((c) => c.loyaltyPoints)).toLocaleString("en")} points held by ${customers.filter((c) => c.loyaltyPoints > 0).length} guests`)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {p.tiers.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1.5">
                  <TierBadge tier={t} size="sm" />
                  <span className="num text-[13px] text-muted">{customers.filter((c) => c.tierId === t.id).length}</span>
                </span>
              ))}
            </div>
          </Section>
          <Section title={L("كارت في المحفظة", "Wallet pass")} icon={<Wallet />}>
            <p className="text-[13.5px] text-muted">{L("Apple Wallet / Google Wallet: الكارت بيتعمل على السيرفر (pass موقّع بشهادة Apple، أو Google Wallet API) وبيتحدّث لما النقاط تتغير. التصميم والخطوات في marketing/DESIGN.md.", "Apple Wallet / Google Wallet: the pass is generated server-side (signed .pkpass / Google Wallet API) and updated on every points change. Design and steps in marketing/DESIGN.md.")}</p>
          </Section>
        </div>
      </div>

      <Section title={L("المستويات", "Tiers")} icon={<Crown />} action={editable ? <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set({ tiers: [...p.tiers, { id: `tier${Date.now().toString(36)}`, name: { ar: "بلاتيني", en: "Platinum" }, minPoints: (p.tiers.at(-1)?.minPoints ?? 0) + 2000, multiplier: 20_000, perks: [], color: "#5b6a64" }] })}>{L("مستوى", "Tier")}</Button> : null}>
        <ul className="grid gap-3">{p.tiers.map(tierRow)}</ul>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title={L("كروت الأختام", "Stamp cards")} icon={<Stamp />} action={editable ? <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set({ stampCards: [...p.stampCards, { id: `stamp${Date.now().toString(36)}`, name: { ar: "اشتري ٥ والسادس مجانًا", en: "Buy 5, the 6th free" }, itemIds: [], categoryIds: [], required: 6, rewardItemId: null, active: true }] })}>{L("كارت", "Card")}</Button> : null}>
          <ul className="grid gap-3">
            {p.stampCards.map((s, i) => (
              <StampEditor key={s.id} s={s} menu={menu.map((m) => ({ value: m.id, label: loc(m.name) }))} onChange={(v) => set({ stampCards: p.stampCards.map((x, j) => (j === i ? v : x)) })} onRemove={() => set({ stampCards: p.stampCards.filter((_, j) => j !== i) })} />
            ))}
            {!p.stampCards.length ? <p className="text-[13.5px] text-muted">{L("مثلًا: اشرب ٩ قهوة والعاشرة علينا", "e.g. drink 9 coffees, the 10th is on us")}</p> : null}
          </ul>
        </Section>
        <Section title={L("المكافآت", "Rewards")} icon={<Gift />} action={editable ? <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set({ rewards: [...p.rewards, { id: `rw${Date.now().toString(36)}`, name: { ar: "مكافأة", en: "Reward" }, cost: 300, kind: "amount", value: major(75), itemId: null, active: true }] })}>{L("مكافأة", "Reward")}</Button> : null}>
          <ul className="grid gap-3">
            {p.rewards.map((r, i) => (
              <RewardEditor key={r.id} r={r} menu={menu.map((m) => ({ value: m.id, label: loc(m.name) }))} onChange={(v) => set({ rewards: p.rewards.map((x, j) => (j === i ? v : x)) })} onRemove={() => set({ rewards: p.rewards.filter((_, j) => j !== i) })} />
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function StampEditor({ s, menu, onChange, onRemove }: { s: StampCard; menu: { value: string; label: string }[]; onChange: (s: StampCard) => void; onRemove: () => void }) {
  const { L } = useT();
  return (
    <li className="grid gap-3 rounded-2xl border border-line p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <LocalizedInput label={L("الاسم", "Name")} value={s.name} onChange={(v) => onChange({ ...s, name: v })} />
        </div>
        <IconButton label={L("امسح", "Remove")} onClick={onRemove}>
          <Trash2 />
        </IconButton>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberInput label={L("عدد الأختام للمكافأة", "Stamps for the reward")} value={s.required} onChange={(n) => onChange({ ...s, required: Math.max(2, Math.round(n)) })} />
        <Select label={L("المكافأة", "Reward item")} value={s.rewardItemId ?? ""} onChange={(e) => onChange({ ...s, rewardItemId: e.target.value || null })} options={[{ value: "", label: L("أي صنف من الكارت", "Any item on the card") }, ...menu]} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {menu.slice(0, 60).map((m) => {
          const on = s.itemIds.includes(m.value);
          return (
            <button key={m.value} type="button" aria-pressed={on} onClick={() => onChange({ ...s, itemIds: on ? s.itemIds.filter((x) => x !== m.value) : [...s.itemIds, m.value] })} className={`h-8 rounded-full border px-2.5 text-[12.5px] font-semibold ${on ? "border-brass bg-brass-soft text-brass-text" : "border-line text-muted hover:bg-surface-2"}`}>
              {m.label}
            </button>
          );
        })}
      </div>
      <Switch checked={s.active} onChange={(v) => onChange({ ...s, active: v })} label={L("شغّال", "Active")} />
    </li>
  );
}

function RewardEditor({ r, menu, onChange, onRemove }: { r: Reward; menu: { value: string; label: string }[]; onChange: (r: Reward) => void; onRemove: () => void }) {
  const { L } = useT();
  return (
    <li className="grid gap-3 rounded-2xl border border-line p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <LocalizedInput label={L("الاسم", "Name")} value={r.name} onChange={(v) => onChange({ ...r, name: v })} />
        </div>
        <IconButton label={L("امسح", "Remove")} onClick={onRemove}>
          <Trash2 />
        </IconButton>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberInput label={L("بكام نقطة", "Cost (points)")} value={r.cost} onChange={(n) => onChange({ ...r, cost: Math.round(n) })} />
        <Select label={L("النوع", "Type")} value={r.kind} onChange={(e) => onChange({ ...r, kind: e.target.value as Reward["kind"], value: e.target.value === "percent" ? 1000 : e.target.value === "amount" ? major(50) : 0 })} options={[{ value: "free_item", label: L("صنف مجاني", "Free item") }, { value: "percent", label: L("خصم ٪", "% off") }, { value: "amount", label: L("خصم مبلغ", "Amount off") }]} />
        {r.kind === "free_item" ? (
          <Select label={L("الصنف", "Item")} value={r.itemId ?? ""} onChange={(e) => onChange({ ...r, itemId: e.target.value || null })} options={[{ value: "", label: "—" }, ...menu]} />
        ) : r.kind === "percent" ? (
          <NumberInput label={L("النسبة", "Percent")} value={r.value / 100} suffix="%" onChange={(n) => onChange({ ...r, value: Math.round(n * 100) })} />
        ) : (
          <MoneyInput label={L("المبلغ", "Amount")} value={r.value} onChange={(u) => onChange({ ...r, value: u })} />
        )}
      </div>
      <Switch checked={r.active} onChange={(v) => onChange({ ...r, active: v })} label={L("متاحة", "Available")} />
    </li>
  );
}

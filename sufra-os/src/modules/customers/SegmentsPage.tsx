import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Megaphone, Plus, Save, Shapes, Trash2, Users } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { LeadSource, Segment } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { major } from "@/lib/money";
import { matchesSegment, RFM_LABEL, SEGMENT_TEMPLATES, type RfmSegment, type SegmentDef, type SegmentRule } from "@/lib/promo";
import { Avatar, Badge, Button, Card, EmptyState, IconButton, Input, Segmented, Select, useToast } from "@/ui";
import { Section, SOURCE_LABEL } from "@/modules/marketing/ui";
import { useCrm } from "./useCrm";

type Field = SegmentRule["field"];
const FIELDS: { value: Field; ar: string; en: string }[] = [
  { value: "lastVisitDays", ar: "آخر زيارة (أيام)", en: "Last visit (days ago)" },
  { value: "visits", ar: "عدد الزيارات", en: "Visits" },
  { value: "totalSpent", ar: "إجمالي الصرف (ج)", en: "Total spend (EGP)" },
  { value: "avgSpend", ar: "متوسط الشيك (ج)", en: "Average spend (EGP)" },
  { value: "points", ar: "النقاط", en: "Points" },
  { value: "joinedDays", ar: "اتسجل من (أيام)", en: "Joined (days ago)" },
  { value: "tag", ar: "تاج", en: "Tag" },
  { value: "item", ar: "طلب صنف", en: "Ordered item" },
  { value: "birthdayMonth", ar: "عيد ميلاد", en: "Birthday" },
  { value: "channel", ar: "المصدر / القناة", en: "Source / channel" },
  { value: "tier", ar: "مستوى الولاء", en: "Loyalty tier" },
  { value: "rfm", ar: "شريحة RFM", en: "RFM segment" },
  { value: "consent", ar: "موافقة", en: "Consent" },
];
const NUMERIC = new Set<Field>(["lastVisitDays", "visits", "totalSpent", "avgSpend", "points", "joinedDays"]);
const MONEY = new Set<Field>(["totalSpent", "avgSpend"]);

function defaultRule(f: Field): SegmentRule {
  switch (f) {
    case "tag":
      return { field: "tag", op: "has", value: "vip" };
    case "item":
      return { field: "item", op: "ordered", value: "" };
    case "birthdayMonth":
      return { field: "birthdayMonth", op: "this" };
    case "channel":
      return { field: "channel", op: "is", value: "online" };
    case "tier":
      return { field: "tier", op: "is", value: "gold" };
    case "rfm":
      return { field: "rfm", op: "is", value: "at_risk" };
    case "consent":
      return { field: "consent", op: "has", value: "whatsapp" };
    default:
      return { field: f, op: "gt", value: MONEY.has(f) ? major(1000) : 30 } as SegmentRule;
  }
}

export default function SegmentsPage() {
  const { L, lang, loc } = useT();
  const db = useDb();
  const navigate = useNavigate();
  const { can } = useSession();
  const { toast } = useToast();
  const crm = useCrm();
  const menu = useLive("menuItems", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const [editing, setEditing] = useState<{ id: string | null; name: string; def: SegmentDef; color: string }>({ id: null, name: "", def: { match: "all", rules: [defaultRule("lastVisitDays")] }, color: "#0d5a53" });
  const now = useMemo(() => new Date(), []);

  const members = useMemo(() => crm.stats.filter((s) => matchesSegment(s, editing.def, now)), [crm.stats, editing.def, now]);
  const countOf = (d: SegmentDef) => crm.stats.filter((s) => matchesSegment(s, d, now)).length;
  const rfmCounts = useMemo(() => {
    const m = new Map<RfmSegment, number>();
    for (const s of crm.stats) if (s.rfm) m.set(s.rfm, (m.get(s.rfm) ?? 0) + 1);
    return m;
  }, [crm.stats]);
  const tags = [...new Set(crm.customers.flatMap((c) => c.tags))].sort();

  const setRule = (i: number, r: SegmentRule) => setEditing((e) => ({ ...e, def: { ...e.def, rules: e.def.rules.map((x, j) => (j === i ? r : x)) } }));
  const save = async () => {
    const name = editing.name.trim() || L("شريحة جديدة", "New segment");
    const row = { name: { ar: name, en: name }, color: editing.color, match: editing.def.match, rules: editing.def.rules, count: members.length };
    const s = editing.id ? await db.update("segments", editing.id, row) : await db.insert("segments", row);
    setEditing((e) => ({ ...e, id: s.id }));
    toast({ title: L("الشريحة اتحفظت", "Segment saved"), tone: "success" });
  };

  return (
    <div className="grid gap-5">
      <Section title={L("شرائح RFM تلقائية", "Automatic RFM segments")} subtitle={L("حداثة الزيارة × عدد الزيارات × الصرف — بتتحدث لوحدها", "Recency × frequency × monetary — always up to date")} icon={<Shapes />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(RFM_LABEL) as RfmSegment[]).map((k) => (
            <Link key={k} to={`/customers?rfm=${k}`} className="rounded-2xl border border-line bg-surface-2 p-3 transition hover:border-line-strong hover:bg-surface">
              <Badge tone={RFM_LABEL[k].tone} dot size="sm">{RFM_LABEL[k][lang]}</Badge>
              <p className="num mt-2 font-display text-[26px] font-semibold">{rfmCounts.get(k) ?? 0}</p>
              <p className="text-[12px] text-muted">{RFM_HINT[k][lang]}</p>
            </Link>
          ))}
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Section title={L("الشرائح المحفوظة", "Saved segments")} icon={<Users />}>
          <ul className="grid gap-2">
            {crm.segments.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
                <span className="size-3 rounded-full" style={{ background: s.color }} />
                <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setEditing({ id: s.id, name: loc(s.name), def: { match: s.match, rules: s.rules }, color: s.color })}>
                  <span className="block truncate font-semibold">{loc(s.name)}</span>
                  <span className="text-[12.5px] text-muted">{L(`${s.rules.length} شرط`, `${s.rules.length} rules`)}</span>
                </button>
                <span className="num text-[18px] font-semibold">{countOf(s)}</span>
                <IconButton label={L("حملة للشريحة", "Campaign to this segment")} onClick={() => navigate(`/marketing/campaigns/new?segment=${s.id}`)}>
                  <Megaphone />
                </IconButton>
              </li>
            ))}
            {!crm.segments.length ? <EmptyState compact title={L("مفيش شرائح محفوظة", "No saved segments")} /> : null}
          </ul>
          <p className="mt-4 mb-2 text-[12.5px] font-semibold text-muted">{L("قوالب جاهزة", "Templates")}</p>
          <div className="flex flex-wrap gap-2">
            {SEGMENT_TEMPLATES.map((t) => (
              <button key={t.key} type="button" onClick={() => setEditing({ id: null, name: t.name[lang], def: t.def, color: "#a8700c" })} className="h-9 rounded-full border border-line px-3 text-[13px] font-semibold hover:bg-surface-2">
                {t.name[lang]} <span className="num text-muted">{countOf(t.def)}</span>
              </button>
            ))}
          </div>
        </Section>

        <Card className="p-5">
          <div className="flex flex-wrap items-end gap-3">
            <Input wrapClassName="min-w-48 flex-1" label={L("اسم الشريحة", "Segment name")} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder={L("مثلًا: زباين التراس", "e.g. Terrace regulars")} />
            <input type="color" aria-label={L("اللون", "Colour")} value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-11 w-14 cursor-pointer rounded-xl border border-line bg-surface p-1" />
            <Segmented size="sm" label={L("طريقة المطابقة", "Match")} value={editing.def.match} onChange={(m) => setEditing({ ...editing, def: { ...editing.def, match: m } })} options={[{ value: "all", label: L("كل الشروط", "All rules") }, { value: "any", label: L("أي شرط", "Any rule") }]} />
          </div>

          <ul className="mt-4 grid gap-2">
            {editing.def.rules.map((r, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-2xl bg-surface-2 p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto]">
                <Select aria-label={L("الحقل", "Field")} value={r.field} onChange={(e) => setRule(i, defaultRule(e.target.value as Field))} options={FIELDS.map((f) => ({ value: f.value, label: lang === "ar" ? f.ar : f.en }))} />
                <div className="sm:contents max-sm:col-span-2 max-sm:grid max-sm:grid-cols-2 max-sm:gap-2">
                  <Select aria-label={L("الشرط", "Operator")} value={r.op} onChange={(e) => setRule(i, { ...r, op: e.target.value } as SegmentRule)} options={opsFor(r.field, L)} />
                  <RuleValue r={r} onChange={(v) => setRule(i, v)} tags={tags} menu={menu.map((m) => ({ value: m.id, label: loc(m.name) }))} tiers={crm.rules.tiers.map((t) => ({ value: t.id, label: loc(t.name) }))} />
                </div>
                <IconButton label={L("امسح الشرط", "Remove rule")} className="max-sm:row-start-1 max-sm:col-start-2" onClick={() => setEditing({ ...editing, def: { ...editing.def, rules: editing.def.rules.filter((_, j) => j !== i) } })}>
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({ ...editing, def: { ...editing.def, rules: [...editing.def.rules, defaultRule("visits")] } })}>
              {L("شرط", "Add rule")}
            </Button>
            <div className="flex-1" />
            <span className="rounded-full bg-primary-soft px-3 py-1.5 text-[14px] font-bold text-primary" aria-live="polite">
              {L(`${members.length} زبون`, `${members.length} customers`)}
            </span>
            {can("marketing.manage") ? (
              <>
                <Button variant="secondary" icon={<Save className="size-4" />} onClick={save}>
                  {L("احفظ", "Save")}
                </Button>
                <Button icon={<Megaphone className="size-4" />} disabled={!editing.id} onClick={() => editing.id && navigate(`/marketing/campaigns/new?segment=${editing.id}`)}>
                  {L("ابعتلهم حملة", "Send a campaign")}
                </Button>
              </>
            ) : null}
            {editing.id && can("marketing.manage") ? (
              <IconButton label={L("امسح الشريحة", "Delete segment")} onClick={async () => {
                await db.remove("segments", editing.id!);
                setEditing({ id: null, name: "", def: { match: "all", rules: [defaultRule("lastVisitDays")] }, color: "#0d5a53" });
              }}>
                <Trash2 />
              </IconButton>
            ) : null}
          </div>

          <ul className="mt-4 grid max-h-80 gap-1 overflow-y-auto thin-scrollbar">
            {members.slice(0, 60).map((s) => {
              const c = crm.customers.find((x) => x.id === s.id)!;
              return (
                <li key={s.id}>
                  <Link to={`/customers/${s.id}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                    <Avatar name={c.name} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{c.name}</span>
                    <span className="num text-[12.5px] text-muted">{L(`${c.visits} زيارة`, `${c.visits} visits`)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

const RFM_HINT: Record<RfmSegment, { ar: string; en: string }> = {
  champions: { ar: "بييجوا كتير وبيصرفوا كتير", en: "Frequent, recent, big spenders" },
  loyal: { ar: "بييجوا بانتظام", en: "Come back regularly" },
  new: { ar: "أول زيارة قريب", en: "First visit recently" },
  promising: { ar: "ممكن يبقوا دايمين", en: "Could become regulars" },
  at_risk: { ar: "كانوا دايمين وغابوا", en: "Were regulars, now away" },
  lost: { ar: "غابوا من زمان", en: "Gone for a long time" },
};

function opsFor(f: Field, L: (a: string, e: string) => string) {
  if (NUMERIC.has(f))
    return [
      { value: "gt", label: L("أكتر من", "more than") },
      { value: "gte", label: L("على الأقل", "at least") },
      { value: "lt", label: L("أقل من", "less than") },
      { value: "lte", label: L("على الأكثر", "at most") },
      { value: "eq", label: L("يساوي", "equals") },
    ];
  if (f === "tag" || f === "consent") return [{ value: "has", label: L("عنده", "has") }, { value: "not", label: L("مش عنده", "doesn't have") }];
  if (f === "item") return [{ value: "ordered", label: L("طلب", "ordered") }, { value: "not_ordered", label: L("ماطلبش", "never ordered") }];
  if (f === "birthdayMonth") return [{ value: "this", label: L("الشهر ده", "this month") }, { value: "next", label: L("الشهر الجاي", "next month") }];
  return [{ value: "is", label: L("هو", "is") }, { value: "not", label: L("مش", "is not") }];
}

function RuleValue({ r, onChange, tags, menu, tiers }: { r: SegmentRule; onChange: (r: SegmentRule) => void; tags: string[]; menu: { value: string; label: string }[]; tiers: { value: string; label: string }[] }) {
  const { L, lang, loc } = useT();
  const aria = L("القيمة", "Value");
  switch (r.field) {
    case "birthdayMonth":
      return <span />;
    case "tag":
      return <Select aria-label={aria} value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value })} options={(tags.length ? tags : ["vip"]).map((t) => ({ value: t, label: t }))} />;
    case "item":
      return <Select aria-label={aria} value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value })} options={[{ value: "", label: "—" }, ...menu]} />;
    case "channel":
      return <Select aria-label={aria} value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value as LeadSource })} options={(Object.keys(SOURCE_LABEL) as LeadSource[]).map((s) => ({ value: s, label: loc(SOURCE_LABEL[s]) }))} />;
    case "tier":
      return <Select aria-label={aria} value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value })} options={tiers} />;
    case "rfm":
      return <Select aria-label={aria} value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value as RfmSegment })} options={(Object.keys(RFM_LABEL) as RfmSegment[]).map((k) => ({ value: k, label: RFM_LABEL[k][lang] }))} />;
    case "consent":
      return <Select aria-label={aria} value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value as "whatsapp" })} options={["whatsapp", "sms", "email", "push"].map((k) => ({ value: k, label: k }))} />;
    default: {
      const money = MONEY.has(r.field);
      return (
        <Input
          aria-label={aria}
          type="number"
          dir="ltr"
          value={money ? r.value / 100_000 : r.value}
          onChange={(e) => onChange({ ...r, value: money ? major(Math.max(0, Number(e.target.value) || 0)) : Math.max(0, Number(e.target.value) || 0) } as SegmentRule)}
        />
      );
    }
  }
}

export type { Segment };

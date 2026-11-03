import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { Download, Filter, GitMerge, Plus, Search, Shapes, Upload, UserPlus, Users } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb } from "@/data/hooks";
import type { Customer, LeadSource } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { formatMoney, sumUnits } from "@/lib/money";
import { ago } from "@/lib/time";
import { RFM_LABEL, type RfmSegment } from "@/lib/promo";
import { Avatar, Badge, Button, Dialog, EmptyState, Input, Money, Select, Skeleton, StatTile, Switch, Table, useToast, type Column } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { RfmBadge, RouteTabs, SOURCE_LABEL, TierBadge } from "@/modules/marketing/ui";
import { useCrm } from "./useCrm";
import { captureLead, findDuplicates, leadsFromReservations, mergeCustomers, previewImport, runImport, toCsv, type ImportPreview } from "./crm";

const CustomerProfile = lazy(() => import("./CustomerProfile"));
const SegmentsPage = lazy(() => import("./SegmentsPage"));

export default function CustomersPage() {
  const { L } = useT();
  return (
    <div className="grid gap-5">
      <PageHeader
        icon={<Users />}
        title={L("الزباين", "Customers")}
        subtitle={L("كل زبون: زياراته وطلباته ونقاطه وتقييماته — ومين محتاج نكلمه", "Every guest: visits, orders, points and feedback — and who to talk to next")}
      />
      <RouteTabs
        label={L("أقسام الزباين", "Customer sections")}
        items={[
          { to: "/customers", end: true, label: L("كل الزباين", "All customers"), icon: <Users /> },
          { to: "/customers/segments", label: L("الشرائح", "Segments"), icon: <Shapes /> },
        ]}
      />
      <Suspense fallback={<Skeleton className="h-96" rounded="rounded-[20px]" />}>
        <Routes>
          <Route index element={<CustomersList />} />
          <Route path="segments" element={<SegmentsPage />} />
          <Route path=":customerId" element={<CustomerProfile />} />
        </Routes>
      </Suspense>
    </div>
  );
}

type Sort = "recent" | "spend" | "visits" | "points" | "name";

function CustomersList() {
  const { L, lang, loc } = useT();
  const navigate = useNavigate();
  const { can } = useSession();
  const db = useDb();
  const { toast } = useToast();
  const crm = useCrm();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const rfm = (params.get("rfm") ?? "") as RfmSegment | "";
  const tier = params.get("tier") ?? "";
  const source = (params.get("source") ?? "") as LeadSource | "";
  const tag = params.get("tag") ?? "";
  const leads = params.get("leads") === "1";
  const [sort, setSort] = useState<Sort>("recent");
  const [dlg, setDlg] = useState<null | "add" | "import" | "dupes">(null);
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const rows = useMemo(() => {
    const list = crm.customers.filter((c) => {
      const s = crm.statsOf(c.id);
      if (q.trim() && !matches(`${c.name} ${c.phone} ${c.email ?? ""} ${c.tags.join(" ")}`, q)) return false;
      if (rfm && s?.rfm !== rfm) return false;
      if (tier && crm.tierOf(c)?.id !== tier) return false;
      if (source && c.source !== source) return false;
      if (tag && !c.tags.includes(tag)) return false;
      if (leads && c.visits > 0) return false;
      return true;
    });
    const by: Record<Sort, (a: Customer, b: Customer) => number> = {
      recent: (a, b) => (b.lastVisitAt ?? b.createdAt).localeCompare(a.lastVisitAt ?? a.createdAt),
      spend: (a, b) => b.totalSpent - a.totalSpent,
      visits: (a, b) => b.visits - a.visits,
      points: (a, b) => b.loyaltyPoints - a.loyaltyPoints,
      name: (a, b) => a.name.localeCompare(b.name, "ar"),
    };
    return list.sort(by[sort]);
  }, [crm, q, rfm, tier, source, tag, leads, sort]);

  const dupes = useMemo(() => findDuplicates(crm.all), [crm.all]);
  const tags = useMemo(() => [...new Set(crm.customers.flatMap((c) => c.tags))].sort(), [crm.customers]);
  const rfmCounts = useMemo(() => {
    const m = new Map<RfmSegment, number>();
    for (const s of crm.stats) if (s.rfm) m.set(s.rfm, (m.get(s.rfm) ?? 0) + 1);
    return m;
  }, [crm.stats]);
  const ltv = sumUnits(crm.customers.map((c) => c.totalSpent));
  const members = crm.customers.filter((c) => c.loyaltyPoints > 0 || c.tags.includes("loyalty")).length;
  const optedIn = crm.customers.filter((c) => c.consent?.whatsapp).length;

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sufra-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cols: Column<Customer>[] = [
    {
      key: "name",
      header: L("الزبون", "Customer"),
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={c.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{c.name}</span>
            <span className="num block text-[12.5px] text-muted" dir="ltr">
              {c.phone}
            </span>
          </span>
        </span>
      ),
    },
    { key: "tier", header: L("المستوى", "Tier"), cell: (c) => <TierBadge tier={crm.tierOf(c)} size="sm" />, hideOnMobile: true },
    { key: "rfm", header: "RFM", cell: (c) => <RfmBadge segment={crm.statsOf(c.id)?.rfm} size="sm" />, hideOnMobile: true },
    { key: "visits", header: L("زيارات", "Visits"), align: "end", cell: (c) => <span className="num">{c.visits}</span> },
    { key: "ltv", header: L("إجمالي الصرف", "Lifetime spend"), align: "end", cell: (c) => <Money value={c.totalSpent} whole />, hideOnMobile: true },
    { key: "points", header: L("نقاط", "Points"), align: "end", cell: (c) => <span className="num font-semibold text-brass-text">{c.loyaltyPoints.toLocaleString("en")}</span>, hideOnMobile: true },
    { key: "last", header: L("آخر زيارة", "Last visit"), align: "end", cell: (c) => <span className="text-[13px] text-muted">{c.lastVisitAt ? ago(c.lastVisitAt, lang) : L("لسه", "never")}</span> },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} icon={<Users />} label={L("زباين", "Customers")} value={crm.customers.length.toLocaleString("en")} sub={L(`${crm.customers.filter((c) => !c.visits).length} عميل محتمل (لسه مازارش)`, `${crm.customers.filter((c) => !c.visits).length} leads (no visit yet)`)} />
        <StatTile index={1} tone="brass" label={L("أعضاء الولاء", "Loyalty members")} value={members.toLocaleString("en")} sub={L(`${optedIn} موافقين على واتساب`, `${optedIn} opted in to WhatsApp`)} />
        <StatTile index={2} tone="ok" label={L("صرفهم كلهم", "Lifetime value")} value={formatMoney(ltv, { lang, whole: true })} sub={L(`متوسط ${formatMoney(crm.customers.length ? ltv / crm.customers.length : 0, { lang, whole: true })} للزبون`, `avg ${formatMoney(crm.customers.length ? ltv / crm.customers.length : 0, { lang, whole: true })} per guest`)} />
        <StatTile index={3} tone="warn" label={L("في خطر", "At risk")} value={(rfmCounts.get("at_risk") ?? 0) + (rfmCounts.get("lost") ?? 0)} sub={L("كانوا بيجوا كتير وبطّلوا", "Used to come often, stopped")} />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={L("شرائح RFM", "RFM segments")}>
        {(Object.keys(RFM_LABEL) as RfmSegment[]).map((k) => (
          <button key={k} type="button" onClick={() => setParam("rfm", rfm === k ? "" : k)} className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors ${rfm === k ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface hover:bg-surface-2"}`}>
            {RFM_LABEL[k][lang]}
            <span className="num text-muted">{rfmCounts.get(k) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 rounded-[20px] border border-line bg-surface p-3 shadow-sf-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("اسم، موبايل، إيميل، تاج…", "Name, phone, email, tag…")} aria-label={L("بحث", "Search")} />
          <Select aria-label={L("المستوى", "Tier")} value={tier} onChange={(e) => setParam("tier", e.target.value)} options={[{ value: "", label: L("كل المستويات", "All tiers") }, ...crm.rules.tiers.map((t) => ({ value: t.id, label: loc(t.name) }))]} />
          <Select aria-label={L("المصدر", "Source")} value={source} onChange={(e) => setParam("source", e.target.value)} options={[{ value: "", label: L("كل المصادر", "All sources") }, ...(Object.keys(SOURCE_LABEL) as LeadSource[]).map((s) => ({ value: s, label: loc(SOURCE_LABEL[s]) }))]} />
          <Select aria-label={L("تاج", "Tag")} value={tag} onChange={(e) => setParam("tag", e.target.value)} options={[{ value: "", label: L("كل التاجز", "All tags") }, ...tags.map((t) => ({ value: t, label: t }))]} />
          <Select aria-label={L("ترتيب", "Sort")} value={sort} onChange={(e) => setSort(e.target.value as Sort)} options={[{ value: "recent", label: L("آخر زيارة", "Last visit") }, { value: "spend", label: L("الأكثر صرفًا", "Top spend") }, { value: "visits", label: L("الأكثر زيارة", "Most visits") }, { value: "points", label: L("النقاط", "Points") }, { value: "name", label: L("الاسم", "Name") }]} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={leads ? "soft" : "secondary"} icon={<Filter className="size-4" />} onClick={() => setParam("leads", leads ? "" : "1")}>
            {L("عملاء محتملين", "Leads")}
          </Button>
          {can("customers.edit") ? (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setDlg("add")}>
              {L("زبون جديد", "Add")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold text-muted">{L(`${rows.length} زبون`, `${rows.length} customers`)}</span>
        <div className="flex-1" />
        {can("customers.edit") ? (
          <>
            <Button size="sm" variant="ghost" icon={<Upload className="size-4" />} onClick={() => setDlg("import")}>
              {L("استيراد CSV", "Import CSV")}
            </Button>
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={async () => {
              const n = await leadsFromReservations(db);
              toast({ title: L(`اتضاف ${n} عميل من الحجوزات`, `${n} leads added from reservations`), tone: "success" });
            }}>
              {L("من الحجوزات", "From reservations")}
            </Button>
            <Button size="sm" variant="ghost" icon={<GitMerge className="size-4" />} onClick={() => setDlg("dupes")}>
              {L("مكررين", "Duplicates")} {dupes.length ? <Badge tone="warn" size="sm">{dupes.length}</Badge> : null}
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={exportCsv}>
          {L("تصدير CSV", "Export CSV")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table
          columns={cols}
          rows={rows.slice(0, 300)}
          rowKey={(c) => c.id}
          loading={crm.loading && !crm.customers.length}
          onRowClick={(c) => navigate(`/customers/${c.id}`)}
          caption={L("الزباين", "Customers")}
          empty={<EmptyState compact icon={<Users />} title={L("مفيش زباين بالفلتر ده", "No customers match")} body={L("غيّر البحث أو الفلاتر", "Change the search or filters")} />}
        />
      </div>

      <AddCustomerDialog open={dlg === "add"} onClose={() => setDlg(null)} onSaved={(c) => navigate(`/customers/${c.id}`)} />
      <ImportDialog open={dlg === "import"} onClose={() => setDlg(null)} existing={crm.all} />
      <Dialog open={dlg === "dupes"} onClose={() => setDlg(null)} size="lg" title={L("زباين مكررين", "Duplicate customers")} description={L("نفس الموبايل (بصيغة مختلفة) أو نفس الاسم وآخر ٧ أرقام", "Same phone (different format) or same name and last 7 digits")}>
        {dupes.length ? (
          <ul className="grid gap-3 pb-1">
            {dupes.map((g) => {
              const keep = [...g].sort((a, b) => b.visits - a.visits)[0];
              return (
                <li key={g.map((c) => c.id).join()} className="rounded-2xl border border-line p-3">
                  <ul className="grid gap-1.5 text-[14px]">
                    {g.map((c) => (
                      <li key={c.id} className="flex items-center gap-2">
                        {c.id === keep.id ? <Badge tone="ok" size="sm">{L("الأساسي", "Keep")}</Badge> : <Badge size="sm">{L("هيندمج", "Merge")}</Badge>}
                        <span className="font-semibold">{c.name}</span>
                        <span className="num text-muted" dir="ltr">{c.phone}</span>
                        <span className="text-muted">· {L(`${c.visits} زيارة`, `${c.visits} visits`)}</span>
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-3" size="sm" variant="soft" icon={<GitMerge className="size-4" />} onClick={async () => {
                    await mergeCustomers(db, keep, g.filter((c) => c.id !== keep.id));
                    toast({ title: L("اندمجوا في ملف واحد", "Merged into one profile"), tone: "success" });
                  }}>
                    {L("ادمجهم", "Merge")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={<GitMerge />} title={L("مفيش تكرار", "No duplicates")} />
        )}
      </Dialog>
    </>
  );
}

export function AddCustomerDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const { L, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", phone: "", email: "", birthday: "", source: "manual" as LeadSource, whatsapp: true, sms: false, notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await captureLead(db, { name: f.name, phone: f.phone, email: f.email || null, birthday: f.birthday || null, source: f.source, notes: f.notes, consent: { whatsapp: f.whatsapp, sms: f.sms } });
      toast({ title: r.created ? L("الزبون اتضاف", "Customer added") : L("الزبون موجود — اتحدّث", "Existing customer updated"), tone: "success" });
      onClose();
      onSaved?.(r.customer);
    } catch {
      setErr(L("رقم موبايل مصري صحيح (01xxxxxxxxx)", "A valid Egyptian mobile (01xxxxxxxxx)"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={L("زبون / عميل محتمل جديد", "New customer / lead")} description={L("من الواي فاي، الحجز، أو يدوي — مع الموافقة على الرسائل", "From Wi-Fi, a reservation or by hand — with messaging consent")} footer={<Button block size="lg" loading={busy} onClick={save}>{L("حفظ", "Save")}</Button>}>
      <div className="grid gap-3 pb-1 sm:grid-cols-2">
        <Input label={L("الاسم", "Name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label={L("الموبايل", "Mobile")} dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={err} placeholder="01xxxxxxxxx" />
        <Input label={L("الإيميل", "Email")} dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label={L("عيد الميلاد", "Birthday")} type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} />
        <Select label={L("المصدر", "Source")} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as LeadSource })} options={(["manual", "wifi", "reservation", "pos", "qr", "online"] as LeadSource[]).map((s) => ({ value: s, label: loc(SOURCE_LABEL[s]) }))} />
        <Input label={L("ملاحظات", "Notes")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <div className="grid gap-1 rounded-2xl bg-surface-2 px-4 py-2 sm:col-span-2">
          <Switch checked={f.whatsapp} onChange={(v) => setF({ ...f, whatsapp: v })} label={L("موافق على رسائل واتساب", "Agrees to WhatsApp messages")} description={L("قانون حماية البيانات ١٥١ لسنة ٢٠٢٠: سجّل الموافقة قبل أي رسالة تسويقية", "PDPL 151/2020: record consent before any marketing message")} />
          <Switch checked={f.sms} onChange={(v) => setF({ ...f, sms: v })} label={L("موافق على SMS", "Agrees to SMS")} />
        </div>
      </div>
    </Dialog>
  );
}

function ImportDialog({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: Customer[] }) {
  const { L } = useT();
  const db = useDb();
  const { toast } = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [p, setP] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async (f: File) => setP(previewImport(await f.text(), existing));
  const counts = p ? { n: p.rows.filter((r) => r.status === "new").length, u: p.rows.filter((r) => r.status === "update").length, x: p.rows.filter((r) => r.status === "invalid").length } : null;
  return (
    <Dialog
      open={open}
      onClose={() => (setP(null), onClose())}
      size="lg"
      title={L("استيراد زباين من CSV", "Import customers from CSV")}
      description={L("أعمدة: name, phone, email, birthday (YYYY-MM-DD), tags (a|b), notes, whatsapp_ok, sms_ok — أو بالعربي: الاسم، الموبايل", "Columns: name, phone, email, birthday (YYYY-MM-DD), tags (a|b), notes, whatsapp_ok, sms_ok")}
      footer={p ? <Button block size="lg" loading={busy} disabled={!counts!.n && !counts!.u} onClick={async () => {
        setBusy(true);
        const r = await runImport(db, p);
        setBusy(false);
        toast({ title: L(`اتضاف ${r.created} واتحدّث ${r.updated}`, `${r.created} added, ${r.updated} updated`), tone: "success" });
        setP(null);
        onClose();
      }}>{L("استورد", "Import")}</Button> : undefined}
    >
      <div className="grid gap-3 pb-1">
        <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
        <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>
          {L("اختار ملف", "Choose file")}
        </Button>
        {counts ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone="ok">{L(`${counts.n} جديد`, `${counts.n} new`)}</Badge>
              <Badge tone="info">{L(`${counts.u} موجود (هيتحدّث)`, `${counts.u} existing (update)`)}</Badge>
              {counts.x ? <Badge tone="danger">{L(`${counts.x} رقم غلط`, `${counts.x} invalid phone`)}</Badge> : null}
            </div>
            <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-2xl border border-line text-[13.5px] thin-scrollbar">
              {p!.rows.slice(0, 100).map((r, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <Badge size="sm" tone={r.status === "new" ? "ok" : r.status === "update" ? "info" : "danger"}>{r.status}</Badge>
                  <span className="min-w-0 flex-1 truncate">{r.name || "—"}</span>
                  <span className="num text-muted" dir="ltr">{r.phone ?? r.raw}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

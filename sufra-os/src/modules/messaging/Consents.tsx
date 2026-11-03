/** Opt-in register: who agreed to WhatsApp messages, when, where and to what wording; opt-outs are final until they opt back in. */
import { useMemo, useState } from "react";
import { History, Plus, Search, ShieldCheck, ShieldX, Users } from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import type { ConsentSource, MessagingConsent } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { prettyPhone, toE164 } from "@/lib/notify/core";
import { Badge, Button, Card, Dialog, Input, Segmented, StatTile, Table, Textarea, useToast } from "@/ui";
import { ConsentBadge } from "./bits";
import { useMessagingService } from "./useMessaging";

export const SOURCE_LABEL: Record<ConsentSource, { ar: string; en: string }> = {
  online_checkout: { ar: "الطلب أونلاين", en: "Online checkout" },
  qr_loyalty: { ar: "نادي الولاء (QR)", en: "Loyalty club (QR)" },
  reservation: { ar: "الحجز", en: "Reservation" },
  staff: { ar: "موظف", en: "Staff" },
  inbound_keyword: { ar: "رسالة من الزبون", en: "Customer keyword" },
  import: { ar: "استيراد", en: "Import" },
};

export default function Consents() {
  const { L, lang } = useT();
  const rows = useLive("messagingConsents").data;
  const customers = useLive("customers").data;
  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | "opted_in" | "opted_out">("all");
  const [add, setAdd] = useState(false);
  const [hist, setHist] = useState<MessagingConsent | null>(null);
  const nameOf = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const shown = rows
    .filter((r) => f === "all" || r.status === f)
    .filter((r) => !q || r.phone.includes(q.replace(/\D/g, "")) || matches(`${nameOf.get(r.customerId ?? "") ?? ""} ${r.wording}`, q))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const inN = rows.filter((r) => r.status === "opted_in").length;
  const outN = rows.filter((r) => r.status === "opted_out").length;
  const dt = (iso: string) => new Date(iso).toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile index={0} icon={<ShieldCheck />} tone="ok" label={L("موافقين", "Opted in")} value={inN} />
        <StatTile index={1} icon={<ShieldX />} tone="danger" label={L("لغوا الاشتراك", "Opted out")} value={outN} />
        <StatTile index={2} icon={<Users />} tone="info" label={L("زباين من غير سجل", "Customers without a record")} value={Math.max(0, customers.length - new Set(rows.map((r) => r.customerId).filter(Boolean)).size)} />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("رقم أو اسم…", "Number or name…")} aria-label={L("بحث", "Search")} wrapClassName="min-w-52 flex-1" />
          <Segmented size="sm" label={L("الحالة", "Status")} value={f} onChange={setF} options={[{ value: "all", label: L("الكل", "All") }, { value: "opted_in", label: L("موافق", "In") }, { value: "opted_out", label: L("لاغي", "Out") }]} />
          <Button icon={<Plus />} onClick={() => setAdd(true)}>{L("سجّل موافقة", "Record consent")}</Button>
        </div>
        <Table
          rows={shown}
          rowKey={(r) => r.id}
          onRowClick={(r) => setHist(r)}
          empty={L("مفيش سجلات", "No records")}
          columns={[
            { key: "p", header: L("الرقم", "Number"), cell: (r) => <span className="flex flex-col"><span className="font-semibold">{nameOf.get(r.customerId ?? "") ?? "—"}</span><span className="num whitespace-nowrap text-[12.5px] text-muted" dir="ltr">{prettyPhone(r.phone)}</span></span> },
            { key: "s", header: L("الحالة", "Status"), cell: (r) => <ConsentBadge consent={r} /> },
            { key: "src", header: L("المصدر", "Source"), cell: (r) => <Badge size="sm">{L(SOURCE_LABEL[r.source].ar, SOURCE_LABEL[r.source].en)}</Badge>, hideOnMobile: true },
            { key: "w", header: L("نص الموافقة", "Wording"), cell: (r) => <span className="line-clamp-2 max-w-80 text-[13px] text-muted" dir="auto">{r.wording || "—"}</span>, hideOnMobile: true },
            { key: "t", header: L("الوقت", "When"), cell: (r) => <span className="num whitespace-nowrap text-[13px]">{dt(r.capturedAt)}</span> },
          ]}
        />
      </Card>
      <p className="text-[12.5px] text-muted">
        {L(
          "قانون حماية البيانات المصري (١٥١/٢٠٢٠) ونظام حماية البيانات السعودي بيطلبوا موافقة واضحة. بنحتفظ بنص الموافقة ومصدرها ووقتها، و«وقف/STOP» بيلغي فورًا.",
          "Egypt PDPL 151/2020 and the KSA PDPL require clear consent. We keep the wording, source and time; “STOP/وقف” opts out immediately.",
        )}
      </p>
      <AddConsent open={add} onClose={() => setAdd(false)} />
      <Dialog open={!!hist} onClose={() => setHist(null)} title={L("سجل الموافقة", "Consent history")} description={hist ? prettyPhone(hist.phone) : undefined} size="sm">
        <ol className="grid gap-2">
          {hist?.history
            .slice()
            .reverse()
            .map((h, i) => (
              <li key={i} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13.5px]">
                <History className="size-4 text-muted" aria-hidden />
                <ConsentBadge consent={h} />
                <span className="text-muted">{L(SOURCE_LABEL[h.source].ar, SOURCE_LABEL[h.source].en)}</span>
                <span className="num ms-auto text-[12px] text-muted">{dt(h.at)}</span>
              </li>
            ))}
        </ol>
      </Dialog>
    </div>
  );
}

function AddConsent({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L } = useT();
  const session = useSession();
  const { svc, ms } = useMessagingService();
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"opted_in" | "opted_out">("opted_in");
  const [wording, setWording] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!toE164(phone, ms.country)) return setErr(L("رقم موبايل صحيح", "A valid mobile number"));
    await svc().recordConsent({ phone, status, source: "staff", wording: wording.trim() || L("موافقة شفهية في المطعم", "Verbal consent in the restaurant"), by: session.staff?.id ?? null });
    toast({ title: L("اتسجل", "Recorded"), tone: "success" });
    setPhone("");
    setWording("");
    setErr(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={L("سجّل موافقة زبون", "Record a customer's consent")} size="sm" footer={<Button block onClick={() => void save()}>{L("احفظ", "Save")}</Button>}>
      <div className="grid gap-3">
        <Input label={L("الموبايل", "Mobile")} value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" error={err ?? undefined} />
        <Segmented block label={L("الحالة", "Status")} value={status} onChange={setStatus} options={[{ value: "opted_in", label: L("موافق", "Opt in") }, { value: "opted_out", label: L("لاغي", "Opt out") }]} />
        <Textarea label={L("قال إيه بالظبط؟", "What exactly did they agree to?")} value={wording} onChange={(e) => setWording(e.target.value)} rows={2} placeholder={L("موافق أستقبل حالة الطلب والعروض على واتساب", "I agree to receive order updates and offers on WhatsApp")} />
      </div>
    </Dialog>
  );
}

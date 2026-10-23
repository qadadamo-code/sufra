import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CheckCheck, ExternalLink, MessageCircle, Printer, QrCode, Trash2 } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, EmptyState, Input, Segmented, Tabs } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { Mark } from "@/shell/Logo";
import type { DiningTable, Localized } from "@/data/types";
import { QrSvg } from "./qr/QrSvg";
import { getNotifier, type SentMessage } from "./notify/notifier";
import { render, TEMPLATES, toMeta, type TemplateId } from "./notify/templates";

const BASE = import.meta.env.BASE_URL;

/** Staff: printable QR table tents (A4, 4 per sheet) + WhatsApp message previews. */
export default function QrSettingsPage() {
  const { L } = useT();
  const [tab, setTab] = useState<"qr" | "wa">("qr");
  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-4 sm:p-6">
      <PageHeader icon={<QrCode />} kicker={L("الضيوف", "Guests")} title={L("أكواد QR والطلب أونلاين", "QR codes & online ordering")} subtitle={L("اطبع كارت لكل ترابيزة — الزبون يمسح ويطلب وينادي الجرسون ويدفع", "Print a tent card per table — guests scan to order, call a waiter and pay")} />
      <Tabs
        label={L("الأقسام", "Sections")}
        value={tab}
        onChange={setTab}
        items={[
          { value: "qr", label: L("كروت الترابيزات", "Table cards"), icon: <QrCode /> },
          { value: "wa", label: L("رسائل واتساب", "WhatsApp messages"), icon: <MessageCircle /> },
        ]}
      />
      {tab === "qr" ? <QrCards /> : <WhatsAppPreview />}
    </div>
  );
}

function QrCards() {
  const { L, loc } = useT();
  const { restaurant } = useSession();
  const { data: tables } = useLive("tables", { where: { active: true } });
  const { data: zones } = useLive("zones", { orderBy: [{ field: "sort" }] });
  const [zone, setZone] = useState<string>("all");
  const [origin, setOrigin] = useState(() => window.location.origin);
  const [picked, setPicked] = useState<Set<string> | null>(null);

  const sorted = useMemo(() => [...tables].sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })), [tables]);
  const shown = sorted.filter((t) => zone === "all" || t.zoneId === zone);
  const selected = shown.filter((t) => !picked || picked.has(t.id));
  const slug = restaurant?.slug ?? "";
  const urlFor = (t: DiningTable) => `${origin.replace(/\/$/, "")}${BASE}r/${slug}/t/${t.code}`;
  const toggle = (id: string) =>
    setPicked((p) => {
      const s = new Set(p ?? shown.map((t) => t.id));
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  if (!restaurant) return null;
  return (
    <div className="grid gap-5">
      <Card className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={L("رابط الموقع", "Site address")} value={origin} onChange={(e) => setOrigin(e.target.value)} dir="ltr" hint={L("الدومين اللي الزبون هيفتحه", "The domain guests will open")} />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">{L("المنطقة", "Area")}</span>
            <Segmented size="sm" label={L("المنطقة", "Area")} value={zone} onChange={(v) => (setZone(v), setPicked(null))} options={[{ value: "all", label: L("الكل", "All") }, ...zones.map((z) => ({ value: z.id, label: loc(z.name) }))]} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<CheckCheck />} onClick={() => setPicked(null)}>
            {L("اختار الكل", "Select all")}
          </Button>
          <Button icon={<Printer />} onClick={() => window.print()} disabled={!selected.length}>
            {L(`اطبع ${selected.length} كارت (A4)`, `Print ${selected.length} cards (A4)`)}
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span>{L("صفحة الطلب أونلاين:", "Online ordering page:")}</span>
        <a className="num inline-flex items-center gap-1 font-semibold text-primary" href={`${BASE}r/${slug}`} target="_blank" rel="noreferrer" dir="ltr">
          {`${origin}${BASE}r/${slug}`}
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      {!shown.length ? (
        <EmptyState icon={<QrCode />} title={L("مفيش ترابيزات", "No tables")} body={L("ضيف ترابيزات من شاشة الصالة", "Add tables from the floor screen")} />
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((t) => {
            const on = !picked || picked.has(t.id);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => toggle(t.id)} aria-pressed={on} className={cn("block w-full rounded-[18px] text-start transition", on ? "ring-2 ring-primary ring-offset-2 ring-offset-bg" : "opacity-50")}>
                  <TentCard name={restaurant.name} label={t.label} url={urlFor(t)} />
                </button>
                <a href={`${BASE}r/${slug}/t/${t.code}`} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-primary">
                  <span className="num">{t.code}</span>
                  <ExternalLink className="size-3" />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <PrintSheet>
        {chunk(selected, 4).map((page, i) => (
          <div key={i} className="qr-page">
            {page.map((t) => (
              <div key={t.id} className="qr-cell">
                <TentCard name={restaurant.name} label={t.label} url={urlFor(t)} print />
              </div>
            ))}
          </div>
        ))}
      </PrintSheet>
    </div>
  );
}

/** One table tent: logo + name, big table number, QR, three steps. Same markup on screen and paper. */
export function TentCard({ name, label, url, print }: { name: Localized; label: string; url: string; print?: boolean }) {
  return (
    <div className={cn("flex aspect-[105/148.5] flex-col overflow-hidden rounded-[16px] border border-[#d9d2c3] bg-[#fbf8f1] text-[#16211e]", print && "h-full w-full rounded-none border-0")}>
      <div className="flex items-center gap-2 bg-[#0d5a53] px-[7%] py-[5%] text-white">
        <Mark className="size-[1.9em] shrink-0" />
        <div className="min-w-0 leading-tight">
          <p className="line-clamp-2 font-display text-[1.05em] font-semibold">{name.ar}</p>
          <p className="truncate text-[0.62em] tracking-wide opacity-80">{name.en}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-[4%] px-[8%] py-[5%] text-center">
        <p className="text-[0.7em] font-semibold tracking-[0.2em] text-[#a8700c] uppercase">ترابيزة · Table</p>
        <p className="num -mt-[2%] text-[3.2em] leading-none font-bold">{label}</p>
        <div className="w-[64%] rounded-[8%] bg-white p-[3%] shadow-[0_1px_0_#e7e0d0]">
          <QrSvg value={url} ecc="Q" className="w-full text-[#16211e]" title={url} />
        </div>
        <p className="text-[0.82em] font-bold">امسح الكود · اطلب · نادي الجرسون · ادفع</p>
        <p className="-mt-[2%] text-[0.62em] text-[#5b6a64]">Scan · Order · Call a waiter · Pay</p>
      </div>
      <p className="pb-[4%] text-center text-[0.5em] text-[#8a9892]">sufra</p>
    </div>
  );
}

const PRINT_CSS = `
.qr-print-root{display:none}
@media print{
  @page{size:A4;margin:0}
  html,body{background:#fff!important}
  body>*:not(.qr-print-root){display:none!important}
  .qr-print-root{display:block}
  .qr-page{width:210mm;height:297mm;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;page-break-after:always;break-after:page}
  .qr-cell{border:0.2mm dashed #bbb;font-size:15pt;overflow:hidden}
}`;

function PrintSheet({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = PRINT_CSS;
    document.head.appendChild(s);
    return () => s.remove();
  }, []);
  return createPortal(<div className="qr-print-root" dir="rtl">{children}</div>, document.body);
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/* ───────── WhatsApp previews ───────── */

function useOutbox(restaurantId: string | undefined) {
  const n = getNotifier();
  const all = useSyncExternalStore(
    (cb) => n.subscribe(cb),
    () => n.all(),
    () => n.all(),
  );
  return all.filter((m) => !restaurantId || m.restaurantId === restaurantId);
}

function WhatsAppPreview() {
  const { L, lang } = useT();
  const { restaurant } = useSession();
  const sent = useOutbox(restaurant?.id);
  const [tpl, setTpl] = useState<TemplateId>("order_out_for_delivery");
  const meta = toMeta(tpl, lang);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="grid content-start gap-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-[18px]">{L("القوالب (Utility)", "Templates (Utility)")}</p>
          <Badge tone="info">{L("الإرسال الفعلي في الموجة التانية", "Live sending: Wave 2")}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => (
            <button key={id} type="button" onClick={() => setTpl(id)} className={cn("num h-8 rounded-full border px-3 text-[12px] font-semibold", tpl === id ? "border-primary bg-primary-soft text-primary" : "border-line")}>
              {id}
            </button>
          ))}
        </div>
        <WaBubble text={render(tpl, lang, TEMPLATES[tpl].sample)} at={new Date().toISOString()} button={TEMPLATES[tpl].button?.label[lang]} />
        <details className="rounded-xl bg-surface-2 p-3 text-[12.5px]">
          <summary className="cursor-pointer font-semibold">{L("شكل القالب لـ Meta", "Meta submission format")}</summary>
          <pre className="num mt-2 overflow-x-auto whitespace-pre-wrap text-[11.5px]" dir="ltr">{JSON.stringify(meta, null, 2)}</pre>
        </details>
      </Card>
      <Card className="grid content-start gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-[18px]">{L("اللي كان هيتبعت", "Would have been sent")}</p>
          {sent.length ? (
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => getNotifier().clear()}>
              {L("امسح", "Clear")}
            </Button>
          ) : null}
        </div>
        {!sent.length ? (
          <p className="py-8 text-center text-[13.5px] text-muted">{L("لما زبون يطلب أونلاين، الرسايل هتظهر هنا", "When a guest orders online, messages show up here")}</p>
        ) : (
          <ul className="grid max-h-[640px] gap-3 overflow-y-auto thin-scrollbar">
            {sent.map((m: SentMessage) => (
              <li key={m.id}>
                <p className="mb-1 flex items-center gap-2 text-[11.5px] text-muted">
                  <span className="num" dir="ltr">{m.to}</span> · <span className="num">{m.template}</span>
                </p>
                <WaBubble text={m.text} at={m.at} button={TEMPLATES[m.template].button?.label[m.lang]} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function WaBubble({ text, at, button }: { text: string; at: string; button?: string }) {
  return (
    <div className="rounded-2xl bg-[#e5ddd5] p-3 dark:bg-[#0b141a]">
      <div className="max-w-[92%] rounded-xl rounded-ss-sm bg-white px-3 py-2 text-[14px] text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
        <p className="whitespace-pre-wrap" dir="auto">{text}</p>
        <p className="num mt-1 text-end text-[10.5px] text-[#667781]">{new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
        {button ? <p className="mt-2 border-t border-black/10 pt-2 text-center text-[13.5px] font-semibold text-[#027eb5] dark:border-white/10">↗ {button}</p> : null}
      </div>
    </div>
  );
}

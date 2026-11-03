/**
 * Guest "contact the restaurant" sheet (public pages): call, WhatsApp, or a complaint form that becomes a ticket in
 * /support. Hotline numbers come from ops settings (local rows / anon RPC guest_contact in cloud) with the venue phone
 * as fallback.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Headset, MessageCircle, Phone, Send } from "lucide-react";
import { useRepo } from "@/data/hooks";
import type { Repo } from "@/data/repo";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Button, Input, Sheet, Textarea } from "@/ui";
import { GUEST_CATEGORIES } from "./tickets";
import { ComplaintError, submitGuestComplaint, waLink } from "./ops";
import { CATEGORY_LABEL } from "./TicketDetail";

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

export async function guestContact(repo: Repo, slug: string): Promise<{ phone: string; whatsapp: string }> {
  try {
    if (repo.kind !== "local") {
      const client = (repo as unknown as { client?: Rpc }).client;
      const r = client ? await client.rpc("guest_contact", { p_slug: slug }) : null;
      const d = (r?.data ?? null) as { phone?: string; whatsapp?: string } | null;
      return { phone: d?.phone ?? "", whatsapp: d?.whatsapp ?? "" };
    }
    const [r] = await repo.list("restaurants", { where: { slug } });
    if (!r) return { phone: "", whatsapp: "" };
    const s = await repo.get("opsSettings", r.id);
    return { phone: s?.hotlinePhone || "", whatsapp: s?.whatsappPhone || "" };
  } catch {
    return { phone: "", whatsapp: "" };
  }
}

export function ContactRestaurant({ slug, tableCode, orderId, fallbackPhone, glass }: { slug: string; tableCode?: string | null; orderId?: string | null; fallbackPhone?: string | null; glass?: boolean }) {
  const { L } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-contact-restaurant
        onClick={() => setOpen(true)}
        aria-label={L("كلّم المطعم", "Contact the restaurant")}
        className={cn(
          "inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold transition active:scale-95 [&_svg]:size-[18px]",
          glass ? "bg-black/35 text-white backdrop-blur-md hover:bg-black/45" : "border border-line bg-surface text-ink-2 hover:bg-surface-2",
        )}
      >
        <Headset />
        <span className="hidden sm:inline">{L("كلّم المطعم", "Contact")}</span>
      </button>
      {open ? <ContactSheet slug={slug} tableCode={tableCode} orderId={orderId} fallbackPhone={fallbackPhone} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ContactSheet({ slug, tableCode, orderId, fallbackPhone, onClose }: { slug: string; tableCode?: string | null; orderId?: string | null; fallbackPhone?: string | null; onClose: () => void }) {
  const { L, lang } = useT();
  const repo = useRepo();
  const [c, setC] = useState({ phone: fallbackPhone ?? "", whatsapp: "" });
  const [d, setD] = useState({ name: "", phone: "", category: "food", body: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    void guestContact(repo, slug).then((x) => setC({ phone: x.phone || fallbackPhone || "", whatsapp: x.whatsapp }));
  }, [repo, slug, fallbackPhone]);
  const send = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await submitGuestComplaint(repo, slug, { ...d, tableCode: tableCode ?? null, orderId: orderId ?? null, channel: tableCode ? "qr" : "online" });
      setDone(r.number);
    } catch (e) {
      const code = e instanceof ComplaintError ? e.message : "x";
      setErr(code === "bad_phone" ? L("رقم الموبايل مش صح", "That mobile number isn't valid") : code === "too_short" ? L("اكتبلنا تفاصيل أكتر شوية", "Tell us a bit more") : L("ما اتبعتش — جرّب تاني", "Not sent — try again"));
    } finally {
      setBusy(false);
    }
  };
  const tile = "flex h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-[15px] font-bold hover:bg-surface-2";
  return (
    <Sheet open onClose={onClose} title={L("كلّم المطعم", "Contact the restaurant")} description={L("اتصل، ابعت واتساب، أو قولنا على أي مشكلة", "Call, WhatsApp, or tell us about a problem")}>
      {done ? (
        <div className="grid justify-items-center gap-3 py-6 text-center" data-complaint-sent={done}>
          <CheckCircle2 className="size-12 text-ok" />
          <p className="text-[18px] font-bold">{L("وصلتنا — شكراً إنك قولتلنا", "Got it — thank you for telling us")}</p>
          <p className="text-[14px] text-muted">{L(`رقم الشكوى ${done}. المدير هيتابع معاك${d.phone ? " على رقمك" : ""}.`, `Reference ${done}. A manager will follow up${d.phone ? " on your number" : ""}.`)}</p>
          <Button onClick={onClose}>{L("تمام", "Done")}</Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2">
            {c.phone ? <a href={`tel:${c.phone}`} className={tile}><Phone className="size-5 text-primary" /> {L("اتصل", "Call")}</a> : <span className={cn(tile, "opacity-50")}><Phone className="size-5" /> {L("اتصل", "Call")}</span>}
            {c.whatsapp || c.phone ? (
              <a href={waLink(c.whatsapp || c.phone, tableCode ? L(`أهلاً، أنا على ترابيزة ${tableCode}`, `Hi, I'm at table ${tableCode}`) : L("أهلاً", "Hi"))} target="_blank" rel="noreferrer" className={tile}>
                <MessageCircle className="size-5 text-ok" /> WhatsApp
              </a>
            ) : null}
          </div>
          <div className="grid gap-3 border-t border-line pt-4">
            <p className="text-[15px] font-bold">{L("عندك شكوى أو اقتراح؟", "A complaint or a suggestion?")}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={L("النوع", "Category")}>
              {GUEST_CATEGORIES.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={d.category === k} onClick={() => setD({ ...d, category: k })} className={cn("h-9 rounded-full border px-3 text-[13.5px] font-semibold", d.category === k ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface")}>
                  {CATEGORY_LABEL[k][lang]}
                </button>
              ))}
            </div>
            <Textarea aria-label={L("التفاصيل", "Details")} rows={4} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} placeholder={L("حصل إيه؟", "What happened?")} />
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label={L("اسمك", "Your name")} placeholder={L("اسمك (اختياري)", "Name (optional)")} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
              <Input aria-label={L("موبايلك", "Your mobile")} placeholder={L("موبايلك للمتابعة", "Mobile for follow-up")} inputMode="tel" dir="ltr" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
            </div>
            {err ? <p className="text-[13.5px] font-semibold text-danger">{err}</p> : null}
            <Button size="lg" loading={busy} icon={<Send className="size-5" />} onClick={() => void send()}>{L("ابعت للمدير", "Send to the manager")}</Button>
            <p className="text-[12px] text-muted">{L("رقمك بيستخدم بس علشان نرد عليك بخصوص الشكوى دي.", "Your number is only used to follow up on this complaint.")}</p>
          </div>
        </div>
      )}
    </Sheet>
  );
}

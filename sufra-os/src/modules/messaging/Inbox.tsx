/**
 * Shared inbox: conversations per customer (unread, assigned, 24h window, consent) + the conversation pane
 * (bubbles with delivery ticks, quick replies, attach a menu item / offer, send an order status or a template,
 * assign, close, record consent). Click-to-chat messages waiting for a tap are listed under "To send".
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Bike, CheckCircle2, ExternalLink, FileText, Gift, Hand, MessageCirclePlus, MoreVertical, Paperclip, RotateCcw, Search, Send, ShieldCheck, ShieldX,
  UserRound, UtensilsCrossed, X, Zap, FlaskConical,
} from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive, useRepo, useRow } from "@/data/hooks";
import type { Conversation, Message, MessagingConsent, Order } from "@/data/types";
import { useT, type Lang } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { matches } from "@/lib/arabic";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { clickToChatUrl, parseWebhook, prettyPhone, toE164, waDigits, windowState } from "@/lib/notify/core";
import { CATALOG, renderTemplate, templateById, varsOf } from "@/lib/notify/templates";
import { STAGE_TEMPLATE } from "@/modules/guest/notify/templates";
import { stageVars, type OrderStage } from "@/modules/delivery/notify";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, IconButton, Input, MenuItem, MenuLabel, MenuSeparator, Popover, Segmented, Sheet, useIsMobile, useToast } from "@/ui";
import { Bubble, ConsentBadge, OptOutIcon, SKIP_REASON, STATUS_LABEL, WindowBadge } from "./bits";
import { byTime, sortConversations, useMessagingService } from "./useMessaging";

type Filter = "all" | "unread" | "mine" | "tosend" | "closed";

/** Open a tab synchronously (click handler), point it at wa.me later (after async work). */
function preopen() {
  let w: Window | null = null;
  let used = false;
  try {
    w = window.open("about:blank", "_blank");
  } catch {
    w = null;
  }
  return {
    open: (url: string) => {
      used = true;
      if (w && !w.closed) {
        try {
          w.opener = null;
        } catch {
          /* ignore */
        }
        w.location.href = url;
      } else window.open(url, "_blank", "noopener,noreferrer");
    },
    done: () => {
      if (w && !used && !w.closed) w.close();
    },
  };
}

export function Inbox() {
  const { L, lang } = useT();
  const { id } = useParams();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const session = useSession();
  const me = session.staff?.id ?? null;
  const { ms, svc } = useMessagingService();
  const conversations = useLive("conversations").data;
  const consents = useLive("messagingConsents").data;
  const taps = useLive("messages", { where: { status: "pending_tap" } }).data;
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const consentByPhone = useMemo(() => new Map(consents.map((c) => [c.phone, c])), [consents]);
  const list = useMemo(() => {
    const xs = conversations
      .filter((c) => (filter === "closed" ? c.status === "closed" : c.status === "open"))
      .filter((c) => (filter === "unread" ? c.unread > 0 : filter === "mine" ? c.assignedTo === me : true))
      .filter((c) => !q || matches(`${c.name} ${c.phone} ${c.lastPreview}`, q) || c.phone.includes(q.replace(/\D/g, "")));
    return xs.sort(sortConversations);
  }, [conversations, filter, q, me]);
  const selected = id ? conversations.find((c) => c.id === id) ?? null : null;

  // desktop: open the first conversation
  useEffect(() => {
    if (!id && !isMobile && list[0] && filter !== "tosend") nav(`/messages/c/${list[0].id}`, { replace: true });
  }, [id, isMobile, list, nav, filter]);

  const showList = !isMobile || !selected;
  const showPane = !isMobile || !!selected;

  return (
    <Card className={cn("grid overflow-hidden md:h-[calc(100dvh-16rem)] md:min-h-[560px] md:grid-cols-[minmax(300px,360px)_1fr]", selected ? "max-md:h-[calc(100dvh-12.5rem)]" : "min-h-[420px]")}>
      {showList ? (
        <aside className="flex min-h-0 flex-col border-line md:border-e" aria-label={L("المحادثات", "Conversations")}>
          <div className="grid gap-2.5 border-b border-line p-3">
            <div className="flex gap-2">
              <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("اسم أو رقم…", "Name or number…")} aria-label={L("بحث", "Search")} wrapClassName="flex-1" />
              <IconButton label={L("محادثة جديدة", "New conversation")} variant="soft" onClick={() => setNewOpen(true)}>
                <MessageCirclePlus />
              </IconButton>
            </div>
            <Segmented
              size="sm"
              block
              label={L("فلتر", "Filter")}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: L("الكل", "All") },
                { value: "unread", label: L("جديدة", "Unread") },
                { value: "mine", label: L("بتوعي", "Mine") },
                { value: "tosend", label: L("للإرسال", "Queue"), badge: taps.length ? <span className="num ms-1 rounded-full bg-brass px-1.5 text-[10.5px] font-bold text-brass-ink">{taps.length}</span> : undefined },
                { value: "closed", label: L("مقفولة", "Closed") },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filter === "tosend" ? (
              <TapQueue taps={taps} conversations={conversations} onOpen={(m, c) => {
                window.open(clickToChatUrl(c.phone, m.body, ms.country), "_blank", "noopener,noreferrer");
                void svc().markOpened(m.id);
              }} />
            ) : list.length ? (
              <ul>
                {list.map((c) => (
                  <ConversationRow key={c.id} c={c} active={c.id === id} consent={consentByPhone.get(c.phone)} mode={ms.mode} onClick={() => nav(`/messages/c/${c.id}`)} lang={lang} />
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={<MessageCirclePlus />} title={L("مفيش محادثات هنا", "No conversations here")} body={L("أول ما زبون يكلمكم على واتساب هيظهر هنا", "When a customer messages you on WhatsApp it shows up here")} />
            )}
          </div>
        </aside>
      ) : null}
      {showPane ? (
        selected ? (
          <ConversationPane key={selected.id} c={selected} consent={consentByPhone.get(selected.phone) ?? null} onBack={() => nav("/messages")} />
        ) : (
          <div className="hidden place-items-center md:grid">
            <EmptyState icon={<MessageCirclePlus />} title={L("اختار محادثة", "Pick a conversation")} body={L("أو ابدأ محادثة جديدة برقم الزبون", "or start a new one with the customer's number")} action={<Button icon={<MessageCirclePlus />} onClick={() => setNewOpen(true)}>{L("محادثة جديدة", "New conversation")}</Button>} />
          </div>
        )
      ) : null}
      <NewConversation open={newOpen} onClose={() => setNewOpen(false)} onCreated={(cid) => nav(`/messages/c/${cid}`)} />
    </Card>
  );
}

function ConversationRow({ c, active, consent, mode, onClick, lang }: { c: Conversation; active: boolean; consent?: MessagingConsent; mode: ReturnType<typeof useMessagingService>["ms"]["mode"]; onClick: () => void; lang: Lang }) {
  const w = windowState(c.lastInboundAt);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn("flex w-full items-start gap-3 border-b border-line/70 px-3.5 py-3 text-start transition-colors hover:bg-surface-2", active && "bg-primary-soft/60 hover:bg-primary-soft/60")}
      >
        <span className="relative">
          <Avatar name={c.name || c.phone} size="md" />
          {(mode === "cloud" || mode === "bsp") && w.open ? <span className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-surface bg-ok" title="24h" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate text-[15px]", c.unread ? "font-bold" : "font-semibold")}>{c.name || prettyPhone(c.phone)}</span>
            {consent?.status === "opted_out" ? <OptOutIcon /> : null}
            <span className="ms-auto shrink-0 text-[11.5px] text-muted">{c.lastMessageAt ? ago(c.lastMessageAt, lang) : ""}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("line-clamp-1 flex-1 text-[13px]", c.unread ? "text-ink" : "text-muted")} dir="auto">{c.lastPreview || prettyPhone(c.phone)}</span>
            {c.unread ? <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-ok px-1.5 text-[11px] font-bold text-white">{c.unread}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function TapQueue({ taps, conversations, onOpen }: { taps: Message[]; conversations: Conversation[]; onOpen: (m: Message, c: Conversation) => void }) {
  const { L, lang } = useT();
  if (!taps.length) return <EmptyState compact icon={<CheckCircle2 />} title={L("مفيش رسايل مستنية", "Nothing waiting")} body={L("رسايل الإرسال بالضغط بتستنى هنا لحد ما تبعتها من واتساب", "Click-to-chat messages wait here until you send them from WhatsApp")} />;
  return (
    <ul className="grid gap-2 p-3">
      {[...taps].sort(byTime).map((m) => {
        const c = conversations.find((x) => x.id === m.conversationId);
        if (!c) return null;
        return (
          <li key={m.id} className="rounded-2xl border border-brass/40 bg-brass-soft/40 p-3">
            <div className="mb-1 flex items-center gap-2 text-[13px]">
              <Hand className="size-4 text-brass" aria-hidden />
              <span className="font-semibold">{c.name}</span>
              <span className="text-muted" dir="ltr">{prettyPhone(c.phone)}</span>
              <span className="ms-auto text-[11.5px] text-muted">{ago(m.createdAt, lang)}</span>
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-[13.5px]" dir="auto">{m.body}</p>
            <Button size="sm" variant="brass" className="mt-2" icon={<ExternalLink />} onClick={() => onOpen(m, c)}>{L("افتح في واتساب وابعت", "Open in WhatsApp & send")}</Button>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────────────────── conversation pane ───────────────────────── */

const QUICK: { ar: string; en: string }[] = [
  { ar: "أهلاً بيك 👋 إزاي نقدر نساعدك؟", en: "Hi 👋 how can we help?" },
  { ar: "تمام، طلبك بيتجهز وهيوصلك في أقرب وقت 🙏", en: "Sure — your order is being prepared and will be with you shortly 🙏" },
  { ar: "حجزك اتأكد ✅ مستنيينك", en: "Your booking is confirmed ✅ see you soon" },
  { ar: "المنيو كامل والطلب أونلاين من هنا: {menu}", en: "Full menu and online ordering here: {menu}" },
  { ar: "آسفين جدًا على التأخير 🙏 بنتابع مع الطيار حالًا", en: "So sorry for the delay 🙏 we're checking with the rider now" },
  { ar: "شكرًا ليك 💚", en: "Thank you 💚" },
];

function ConversationPane({ c, consent, onBack }: { c: Conversation; consent: MessagingConsent | null; onBack: () => void }) {
  const { L, lang, dir } = useT();
  const repo = useRepo();
  const session = useSession();
  const { toast } = useToast();
  const { ms, svc, db } = useMessagingService();
  const messages = useLive("messages", { where: { conversationId: c.id }, orderBy: [{ field: "createdAt" }] }).data;
  const customer = useRow("customers", c.customerId).data;
  const staff = useLive("memberships", { where: { active: true, role: ["owner", "admin", "manager", "cashier"] } }).data;
  const assignee = staff.find((s) => s.id === c.assignedTo) ?? null;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "menu" | "offer" | "order" | "template" | "simulate">(null);
  const scroller = useRef<HTMLDivElement>(null);
  const w = windowState(c.lastInboundAt);
  const cloud = ms.mode === "cloud" || ms.mode === "bsp";
  const canFreeText = ms.mode !== "off" && (!cloud || w.open) && consent?.status !== "opted_out";
  const menuLink = `${window.location.origin}${import.meta.env.BASE_URL}r/${session.restaurant?.slug ?? ""}`;

  useEffect(() => {
    if (c.unread) void db.update("conversations", c.id, { unread: 0 });
  }, [c.id, c.unread, db]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

  /** run a send; click-to-chat opens WhatsApp in a tab opened right now (popup-safe) */
  const run = async (fn: (s: ReturnType<typeof svc>) => Promise<Message>, okMsg?: string) => {
    const tab = ms.mode === "click_to_chat" ? preopen() : null;
    setBusy(true);
    try {
      const m = await fn(svc(tab?.open));
      if (m.status === "skipped") toast({ title: L("ماتبعتتش", "Not sent"), description: L(SKIP_REASON[m.error ?? ""]?.ar ?? m.error ?? "", SKIP_REASON[m.error ?? ""]?.en ?? m.error ?? ""), tone: "warn" });
      else if (m.status === "failed") toast({ title: L("الإرسال فشل", "Send failed"), description: m.error ?? undefined, tone: "error" });
      else if (okMsg) toast({ title: okMsg, tone: "success" });
      return m;
    } catch (e) {
      toast({ title: L("حصلت مشكلة", "Something went wrong"), description: (e as Error).message, tone: "error" });
      return null;
    } finally {
      tab?.done();
      setBusy(false);
    }
  };

  const sendText = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    const m = await run((s) => s.send({ conversationId: c.id, text: t, lang }));
    if (m && m.status !== "skipped" && m.status !== "failed") setDraft("");
  };

  const assign = (id: string | null) => void svc().assign(c.id, id);
  const recordConsent = async (status: "opted_in" | "opted_out") => {
    await svc().recordConsent({ phone: c.phone, status, source: "staff", wording: status === "opted_in" ? L("الزبون وافق يستقبل رسايل واتساب (سجّلها الموظف)", "Customer agreed to WhatsApp messages (recorded by staff)") : L("الزبون طلب يوقف الرسايل", "Customer asked to stop messages"), by: session.staff?.id ?? null, customerId: c.customerId });
    toast({ title: status === "opted_in" ? L("اتسجلت الموافقة", "Opt-in recorded") : L("اتسجل إلغاء الاشتراك", "Opt-out recorded"), tone: "success" });
  };

  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <section className="flex min-h-0 min-w-0 flex-col" aria-label={c.name}>
      <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 md:px-4">
        <IconButton label={L("رجوع", "Back")} className="md:hidden" onClick={onBack}>
          <BackIcon />
        </IconButton>
        <Avatar name={c.name || c.phone} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-sans text-[16px] font-bold">{c.name || prettyPhone(c.phone)}</h2>
            {customer?.tags.includes("vip") ? <Badge tone="brass" size="sm">VIP</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
            <span dir="ltr" className="num">{prettyPhone(c.phone)}</span>
            <WindowBadge lastInboundAt={c.lastInboundAt} mode={ms.mode} />
            <ConsentBadge consent={consent} />
            {assignee ? <Badge size="sm" tone="info" icon={<UserRound />}>{assignee.name.split(" ")[0]}</Badge> : null}
          </div>
        </div>
        <a href={`https://wa.me/${waDigits(c.phone)}`} target="_blank" rel="noreferrer" className="hidden sm:inline-flex">
          <Button variant="ghost" size="sm" icon={<ExternalLink />}>{L("واتساب", "WhatsApp")}</Button>
        </a>
        <Popover
          align="end"
          trigger={({ props }) => (
            <IconButton label={L("خيارات", "Options")} {...props}>
              <MoreVertical />
            </IconButton>
          )}
        >
          {(close) => (
          <div onClickCapture={() => setTimeout(close, 0)}>
          <MenuLabel>{L("تحويل لـ", "Assign to")}</MenuLabel>
          {staff.map((s) => (
            <MenuItem key={s.id} active={s.id === c.assignedTo} onClick={() => assign(s.id)} icon={<Avatar name={s.name} color={s.color} size="xs" />}>
              {s.name}
            </MenuItem>
          ))}
          <MenuItem onClick={() => assign(null)} icon={<X />}>{L("من غير تحويل", "Unassigned")}</MenuItem>
          <MenuSeparator />
          {consent?.status === "opted_in" ? (
            <MenuItem danger icon={<ShieldX />} onClick={() => void recordConsent("opted_out")}>{L("سجّل إلغاء الاشتراك", "Record opt-out")}</MenuItem>
          ) : (
            <MenuItem icon={<ShieldCheck />} onClick={() => void recordConsent("opted_in")}>{L("سجّل موافقة الزبون", "Record opt-in")}</MenuItem>
          )}
          <MenuItem icon={c.status === "open" ? <CheckCircle2 /> : <RotateCcw />} onClick={() => void svc().setStatus(c.id, c.status === "open" ? "closed" : "open")}>
            {c.status === "open" ? L("اقفل المحادثة", "Close conversation") : L("افتحها تاني", "Reopen")}
          </MenuItem>
          {repo.kind === "local" ? (
            <>
              <MenuSeparator />
              <MenuItem icon={<FlaskConical />} onClick={() => setSheet("simulate")}>{L("تجربة: رسالة من الزبون", "Demo: message from customer")}</MenuItem>
            </>
          ) : null}
          </div>
          )}
        </Popover>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[radial-gradient(var(--sf-line)_1px,transparent_1px)] [background-size:18px_18px] px-3 py-4 md:px-5" aria-live="polite">
        {messages.length ? null : <p className="py-10 text-center text-[13px] text-muted">{L("مفيش رسايل لسه", "No messages yet")}</p>}
        {[...messages].sort(byTime).map((m, i, arr) => {
          const day = new Date(m.createdAt).toDateString();
          const showDay = i === 0 || new Date(arr[i - 1].createdAt).toDateString() !== day;
          return (
            <div key={m.id}>
              {showDay ? (
                <div className="my-3 text-center">
                  <span className="rounded-full bg-surface px-3 py-1 text-[11.5px] font-semibold text-muted shadow-sf-sm">{new Date(m.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "short" })}</span>
                </div>
              ) : null}
              <Bubble
                m={m}
                footer={
                  m.status === "failed" || m.status === "skipped" || m.status === "pending_tap" || m.status === "scheduled" ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-line/60 pt-1.5 text-[12px]">
                      <span className={cn(m.status === "failed" ? "text-danger" : "text-muted")}>
                        {m.status === "scheduled" && m.sendAt
                          ? `${L(STATUS_LABEL.scheduled.ar, STATUS_LABEL.scheduled.en)} · ${new Date(m.sendAt).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" })}`
                          : m.status === "skipped"
                            ? L(SKIP_REASON[m.error ?? ""]?.ar ?? STATUS_LABEL.skipped.ar, SKIP_REASON[m.error ?? ""]?.en ?? STATUS_LABEL.skipped.en)
                            : m.status === "pending_tap"
                              ? L(STATUS_LABEL.pending_tap.ar, STATUS_LABEL.pending_tap.en)
                              : m.error}
                      </span>
                      {m.status === "pending_tap" ? (
                        <Button size="sm" variant="brass" icon={<ExternalLink />} onClick={() => { window.open(clickToChatUrl(c.phone, m.body, ms.country), "_blank", "noopener,noreferrer"); void svc().markOpened(m.id); }}>
                          {L("ابعت من واتساب", "Send in WhatsApp")}
                        </Button>
                      ) : m.status === "failed" ? (
                        <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => void run((s) => s.dispatch({ ...m, status: "queued" }))}>{L("حاول تاني", "Retry")}</Button>
                      ) : null}
                    </div>
                  ) : null
                }
              />
            </div>
          );
        })}
      </div>

      <footer className="border-t border-line bg-surface p-2.5 md:p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          {QUICK.map((qr, i) => (
            <button key={i} type="button" className="shrink-0 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 hover:border-primary hover:text-primary" onClick={() => setDraft(L(qr.ar, qr.en).replace("{menu}", menuLink))}>
              <Zap className="me-1 inline size-3.5 text-brass" aria-hidden />
              {L(qr.ar, qr.en).replace("{menu}", L("المنيو", "menu")).slice(0, 34)}
              {L(qr.ar, qr.en).length > 34 ? "…" : ""}
            </button>
          ))}
        </div>
        {cloud && !w.open ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
            {L("الزبون مكلمكش من أكتر من ٢٤ ساعة — واتساب بيسمح بقوالب معتمدة بس.", "The customer hasn't written in 24h — WhatsApp only allows approved templates.")}
            <Button size="sm" variant="soft" icon={<FileText />} onClick={() => setSheet("template")}>{L("ابعت قالب", "Send a template")}</Button>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <Popover
            side="top"
            trigger={({ props }) => (
              <IconButton label={L("إرفاق", "Attach")} variant="soft" {...props}>
                <Paperclip />
              </IconButton>
            )}
          >
            {(close) => (
            <div onClickCapture={() => setTimeout(close, 0)}>
            <MenuItem icon={<UtensilsCrossed />} onClick={() => setSheet("menu")}>{L("صنف من المنيو", "Menu item")}</MenuItem>
            <MenuItem icon={<Gift />} onClick={() => setSheet("offer")}>{L("عرض أو كوبون", "Offer or coupon")}</MenuItem>
            <MenuItem icon={<Bike />} onClick={() => setSheet("order")}>{L("حالة طلب", "Order status")}</MenuItem>
            <MenuItem icon={<FileText />} onClick={() => setSheet("template")}>{L("قالب واتساب", "WhatsApp template")}</MenuItem>
            </div>
            )}
          </Popover>
          <label className="sr-only" htmlFor={`draft-${c.id}`}>{L("رسالتك", "Your message")}</label>
          <textarea
            id={`draft-${c.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canFreeText) void sendText(draft);
              }
            }}
            rows={1}
            dir="auto"
            disabled={!canFreeText}
            placeholder={consent?.status === "opted_out" ? L("الزبون لغى الاشتراك", "Customer opted out") : canFreeText ? (ms.mode === "click_to_chat" ? L("اكتب… هتتفتح في واتساب للإرسال", "Type… opens in WhatsApp to send") : L("اكتب رسالة…", "Type a message…")) : L("استخدم قالب", "Use a template")}
            className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5 text-[15px] outline-none [field-sizing:content] focus:border-primary focus:bg-surface disabled:opacity-60"
          />
          <IconButton label={L("ابعت", "Send")} variant="primary" disabled={!canFreeText || !draft.trim() || busy} onClick={() => void sendText(draft)}>
            <Send className="rtl:-scale-x-100" />
          </IconButton>
        </div>
      </footer>

      <MenuItemSheet open={sheet === "menu"} onClose={() => setSheet(null)} menuLink={menuLink} onPick={(t) => setDraft((d) => (d ? `${d}\n${t}` : t))} />
      <OfferSheet open={sheet === "offer"} onClose={() => setSheet(null)} menuLink={menuLink} onPick={(t) => setDraft((d) => (d ? `${d}\n${t}` : t))} />
      <OrderStatusSheet open={sheet === "order"} onClose={() => setSheet(null)} c={c} run={run} />
      <TemplateSheet open={sheet === "template"} onClose={() => setSheet(null)} c={c} run={run} />
      <SimulateSheet open={sheet === "simulate"} onClose={() => setSheet(null)} c={c} />
    </section>
  );
}

/* ───────── attach: menu item ───────── */

function MenuItemSheet({ open, onClose, onPick, menuLink }: { open: boolean; onClose: () => void; onPick: (text: string) => void; menuLink: string }) {
  const { L, lang, loc } = useT();
  const items = useLive("menuItems", { where: { active: true } }, { enabled: open }).data;
  const [q, setQ] = useState("");
  const shown = items.filter((i) => !q || matches(`${i.name.ar} ${i.name.en}`, q)).slice(0, 40);
  return (
    <Sheet open={open} onClose={onClose} title={L("ابعت صنف من المنيو", "Share a menu item")} size="md">
      <div className="grid gap-3">
        <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر في المنيو…", "Search the menu…")} aria-label={L("بحث", "Search")} />
        <ul className="grid gap-1.5">
          {shown.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-start hover:border-primary"
                onClick={() => {
                  onPick(`🍽️ ${loc(i.name)} — ${formatMoney(i.price, { lang })}${loc(i.description) ? `\n${loc(i.description)}` : ""}\n${L("اطلب من هنا", "Order here")}: ${menuLink}`);
                  onClose();
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{loc(i.name)}</span>
                  <span className="block truncate text-[12.5px] text-muted">{loc(i.description)}</span>
                </span>
                <span className="num text-[13.5px] font-semibold">{formatMoney(i.price, { lang })}</span>
                {!i.available ? <Badge size="sm" tone="warn">{L("خلصان", "Sold out")}</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

/* ───────── attach: offer / coupon (CRM promotions) ───────── */

function OfferSheet({ open, onClose, onPick, menuLink }: { open: boolean; onClose: () => void; onPick: (text: string) => void; menuLink: string }) {
  const { L, loc } = useT();
  const promos = useLive("promotions", undefined, { enabled: open }).data as unknown as { id: string; name: { ar: string; en: string }; description?: { ar: string; en: string }; code: string | null; active: boolean; kind: string }[];
  const shown = promos.filter((p) => p.active);
  return (
    <Sheet open={open} onClose={onClose} title={L("ابعت عرض أو كوبون", "Share an offer or coupon")} description={L("داخل نافذة الـ ٢٤ ساعة الرسالة دي بتتحسب خدمة مش تسويق", "Inside the 24h window this goes as a service message, not marketing")} size="md">
      {shown.length ? (
        <ul className="grid gap-1.5">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-start hover:border-primary"
                onClick={() => {
                  onPick(`🎁 ${loc(p.name)}${p.description ? ` — ${loc(p.description)}` : ""}${p.code ? `\n${L("الكود", "Code")}: ${p.code}` : ""}\n${menuLink}`);
                  onClose();
                }}
              >
                <Gift className="size-5 text-brass" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{loc(p.name)}</span>
                  {p.description ? <span className="block truncate text-[12.5px] text-muted">{loc(p.description)}</span> : null}
                </span>
                {p.code ? <Badge tone="brass" size="sm"><span dir="ltr" className="font-mono">{p.code}</span></Badge> : <Badge size="sm">{L("تلقائي", "Auto")}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={<Gift />} title={L("مفيش عروض شغالة", "No active offers")} body={L("اعمل عرض من التسويق الأول", "Create one in Marketing first")} />
      )}
    </Sheet>
  );
}

/* ───────── order status (manual) ───────── */

const STAGES: { stage: OrderStage; ar: string; en: string }[] = [
  { stage: "received", ar: "وصل", en: "Received" },
  { stage: "accepted", ar: "بيتجهز", en: "Preparing" },
  { stage: "ready_pickup", ar: "جاهز للاستلام", en: "Ready for pickup" },
  { stage: "out_for_delivery", ar: "خرج للتوصيل", en: "Out for delivery" },
  { stage: "delivered", ar: "اتسلّم", en: "Delivered" },
  { stage: "delayed", ar: "متأخر", en: "Delayed" },
  { stage: "cancelled", ar: "اتلغى", en: "Cancelled" },
];

function OrderStatusSheet({ open, onClose, c, run }: { open: boolean; onClose: () => void; c: Conversation; run: (fn: (s: ReturnType<ReturnType<typeof useMessagingService>["svc"]>) => Promise<Message>, ok?: string) => Promise<Message | null> }) {
  const { L, lang } = useT();
  const { db } = useMessagingService();
  const session = useSession();
  const orders = useLive("orders", { where: { customerId: c.customerId ?? "-" }, orderBy: [{ field: "openedAt", dir: "desc" }], limit: 6 }, { enabled: open && !!c.customerId }).data;
  const [order, setOrder] = useState<Order | null>(null);
  useEffect(() => setOrder(orders[0] ?? null), [orders]);

  const send = async (stage: OrderStage) => {
    if (!order || !session.restaurant) return;
    const m = await run(async (s) => {
      const customer = { name: c.name, phone: c.phone };
      const branch = await db.get("branches", order.branchId);
      const driver = order.driverId ? await db.get("memberships", order.driverId) : null;
      const check = order.checkId ? await db.get("checks", order.checkId) : null;
      const vars = stageVars(stage, { order, customer, restaurant: session.restaurant!, branch, driver, total: check?.total, paid: check?.paid, lang });
      return s.send({ conversationId: c.id, template: STAGE_TEMPLATE[stage], vars, lang, orderId: order.id, transactional: true });
    }, L("الحالة اتبعتت", "Status sent"));
    if (m) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={L("ابعت حالة طلب", "Send an order status")} description={L("قالب Utility معتمد — ينفع حتى لو النافذة مقفولة", "An approved Utility template — works even when the window is closed")} size="md">
      {!c.customerId || !orders.length ? (
        <EmptyState compact icon={<Bike />} title={L("مفيش طلبات للزبون ده", "No orders for this customer")} />
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            {orders.map((o) => (
              <button key={o.id} type="button" onClick={() => setOrder(o)} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-start", order?.id === o.id ? "border-primary bg-primary-soft/50" : "border-line")}>
                <span className="num font-bold">#{o.number}</span>
                <span className="text-[13px] text-muted">{{ dine_in: L("صالة", "Dine-in"), takeaway: L("تيك أواي", "Takeaway"), delivery: L("دليفري", "Delivery") }[o.mode as "dine_in" | "takeaway" | "delivery"] ?? o.mode}</span>
                <span className="ms-auto text-[12px] text-muted">{ago(o.openedAt, lang)}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STAGES.filter((s) => s.stage !== "ready_pickup" || order?.mode === "takeaway").map((s) => (
              <Button key={s.stage} variant={s.stage === "cancelled" ? "danger-soft" : "outline"} onClick={() => void send(s.stage)} disabled={!order}>
                {L(s.ar, s.en)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ───────── template ───────── */

function TemplateSheet({ open, onClose, c, run }: { open: boolean; onClose: () => void; c: Conversation; run: (fn: (s: ReturnType<ReturnType<typeof useMessagingService>["svc"]>) => Promise<Message>, ok?: string) => Promise<Message | null> }) {
  const { L, lang: uiLang, loc } = useT();
  const session = useSession();
  const [id, setId] = useState("feedback_request");
  const [lang, setLang] = useState<Lang>(uiLang);
  const [vars, setVars] = useState<Record<string, string>>({});
  const tpl = templateById(id)!;
  const names = varsOf(id);
  useEffect(() => {
    const first = (c.name || "").split(" ")[0];
    setVars(Object.fromEntries(names.map((n) => [n, n === "name" ? first : n === "restaurant" ? loc(session.restaurant?.name) : ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, open]);
  const [tried, setTried] = useState(false);
  useEffect(() => setTried(false), [id, open]);
  const missing = names.filter((n) => !String(vars[n] ?? "").trim());
  // preview: what's typed, sample values for the blanks
  const preview = renderTemplate(id, lang, { ...tpl.sample, ...Object.fromEntries(Object.entries(vars).filter(([, v]) => String(v).trim())) });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={L("ابعت قالب واتساب", "Send a WhatsApp template")}
      description={L("القوالب لازم تكون معتمدة من Meta بنفس الاسم واللغة", "Templates must be approved by Meta with the same name and language")}
      footer={
        <Button block icon={<Send />} onClick={async () => { setTried(true); if (missing.length) return; const m = await run((s) => s.send({ conversationId: c.id, template: id, vars, lang, transactional: tpl.category !== "MARKETING" }), L("القالب اتبعت", "Template sent")); if (m) onClose(); }}>
          {L("ابعت", "Send")}
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <label className="grid gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">{L("القالب", "Template")}</span>
            <select value={id} onChange={(e) => setId(e.target.value)} className="h-11 rounded-xl border border-line bg-surface px-3 text-[15px]">
              {CATALOG.filter((t) => t.category !== "AUTHENTICATION").map((t) => (
                <option key={t.id} value={t.id}>{`${L(t.title.ar, t.title.en)} · ${t.category}`}</option>
              ))}
            </select>
          </label>
          <Segmented size="sm" label={L("اللغة", "Language")} value={lang} onChange={setLang} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
          {names.map((n) => (
            <Input key={n} label={<span dir="ltr" className="font-mono text-[12.5px]">{`{{${n}}}`}</span>} value={vars[n] ?? ""} onChange={(e) => setVars((v) => ({ ...v, [n]: e.target.value }))} placeholder={tpl.sample[n]} error={tried && missing.includes(n) ? L("مطلوب", "Required") : undefined} />
          ))}
        </div>
        <div className="rounded-2xl bg-[radial-gradient(var(--sf-line)_1px,transparent_1px)] [background-size:16px_16px] p-3">
          <Bubble m={{ direction: "out", body: preview, status: "queued", createdAt: new Date().toISOString(), kind: "template", template: id, category: tpl.category === "MARKETING" ? "marketing" : "utility" }} />
          {tpl.category === "MARKETING" ? <p className="mt-2 text-[12px] text-muted">{L("تسويق: محتاج موافقة صريحة، وبيتكلف حوالي ١٨ ضعف الـ Utility في مصر.", "Marketing: needs explicit opt-in and costs ≈18× Utility in Egypt.")}</p> : null}
        </div>
      </div>
    </Sheet>
  );
}

/* ───────── demo: simulate an inbound message (local mode only) ───────── */

function SimulateSheet({ open, onClose, c }: { open: boolean; onClose: () => void; c: Conversation }) {
  const { L } = useT();
  const { svc } = useMessagingService();
  const [text, setText] = useState("");
  const simulate = async (t: string) => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "DEMO" }, contacts: [{ wa_id: waDigits(c.phone), profile: { name: c.name } }], messages: [{ from: waDigits(c.phone), id: `wamid.demo.${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: t } }] } }] }],
    };
    await svc().ingest(parseWebhook(payload));
    setText("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={L("تجربة: رسالة واردة", "Demo: incoming message")} description={L("بيمشي بنفس منطق الـ webhook — جرّب «وقف» أو «STOP»", "Runs the same logic as the webhook — try “STOP” or «وقف»")}
      footer={<Button block onClick={() => void simulate(text)} disabled={!text.trim()}>{L("استقبل", "Receive")}</Button>}>
      <div className="grid gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={L("اكتب رسالة الزبون…", "Type the customer's message…")} aria-label={L("الرسالة", "Message")} />
        <div className="flex flex-wrap gap-1.5">
          {["فين الطلب؟", "وقف", "STOP", "اشتراك"].map((x) => (
            <button key={x} type="button" className="rounded-full border border-line px-3 py-1 text-[12.5px]" onClick={() => void simulate(x)}>{x}</button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/* ───────── new conversation ───────── */

function NewConversation({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { L } = useT();
  const { svc, ms } = useMessagingService();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<ReactNode>(null);
  const create = async () => {
    const e = toE164(phone, ms.country);
    if (!e) return setErr(L("رقم موبايل صحيح: 01xxxxxxxxx أو 05xxxxxxxx", "A valid mobile: 01xxxxxxxxx or 05xxxxxxxx"));
    const conv = await svc().conversationFor(e, { name: name.trim() || undefined });
    setPhone("");
    setName("");
    setErr(null);
    onClose();
    onCreated(conv.id);
  };
  return (
    <Dialog open={open} onClose={onClose} title={L("محادثة جديدة", "New conversation")} size="sm" footer={<Button block onClick={() => void create()}>{L("ابدأ", "Start")}</Button>}>
      <div className="grid gap-3">
        <Input label={L("الموبايل", "Mobile")} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" error={err ?? undefined} autoFocus />
        <Input label={L("الاسم (اختياري)", "Name (optional)")} value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-[12.5px] text-muted">{L("في وضع Cloud API أول رسالة لازم تكون قالب معتمد.", "In Cloud API mode the first message must be an approved template.")}</p>
      </div>
    </Dialog>
  );
}

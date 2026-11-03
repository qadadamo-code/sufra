/** /messages — inbox, templates, consent and the message log, with one header + sub-nav. */
import { lazy, Suspense } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { FileText, Inbox as InboxIcon, MessageCircle, ScrollText, Settings2, ShieldCheck } from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, LinkButton, Skeleton } from "@/ui";
import { Inbox } from "./Inbox";
import { useMessagingSettings } from "./useMessaging";

const Templates = lazy(() => import("./Templates"));
const Consents = lazy(() => import("./Consents"));
const MessageLog = lazy(() => import("./MessageLog"));

export default function MessagesPage() {
  const { L } = useT();
  const { can } = useSession();
  const { ms } = useMessagingSettings();
  // phones: an open conversation takes the whole screen (WhatsApp-like)
  const inConversation = /\/messages\/c\//.test(useLocation().pathname);
  const unread = useLive("conversations", { where: { status: "open" } }).data.filter((c) => c.unread > 0).length;
  const modeBadge =
    ms.mode === "cloud" ? (
      <Badge tone="ok" dot>{L("واتساب Cloud API", "WhatsApp Cloud API")}</Badge>
    ) : ms.mode === "click_to_chat" ? (
      <Badge tone="primary" dot>{L("إرسال بالضغط (wa.me)", "Click-to-chat (wa.me)")}</Badge>
    ) : ms.mode === "bsp" ? (
      <Badge tone="info" dot>{`BSP · ${ms.bsp ?? "—"}`}</Badge>
    ) : (
      <Badge tone="warn" dot>{L("الرسايل مقفولة", "Messaging off")}</Badge>
    );
  const tabs = [
    { to: "/messages", end: true, icon: <InboxIcon />, label: L("الوارد", "Inbox"), count: unread },
    { to: "/messages/templates", icon: <FileText />, label: L("القوالب", "Templates") },
    { to: "/messages/consent", icon: <ShieldCheck />, label: L("الموافقات", "Opt-in") },
    { to: "/messages/log", icon: <ScrollText />, label: L("سجل الرسايل", "Message log") },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader
        className={inConversation ? "max-md:hidden" : undefined}
        icon={<MessageCircle />}
        title={L("واتساب", "WhatsApp")}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{L("كل محادثات الزباين في مكان واحد", "Every customer conversation in one place")} {modeBadge}</span>}
        actions={can("settings.view") ? <LinkButton to="/settings/messaging" variant="outline" icon={<Settings2 />} aria-label={L("إعدادات الرسايل", "Messaging settings")}><span className="max-sm:hidden">{L("إعدادات الرسايل", "Messaging settings")}</span></LinkButton> : null}
      />
      <nav className={cn("-mb-2 flex gap-1 overflow-x-auto border-b border-line no-scrollbar", inConversation && "max-md:hidden")} aria-label={L("أقسام الرسايل", "Messaging sections")}>
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => cn("relative -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-[14.5px] font-semibold transition-colors [&_svg]:size-4", isActive ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink")}
          >
            {t.icon}
            {t.label}
            {t.count ? <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-brass px-1.5 text-[11px] font-bold text-brass-ink">{t.count}</span> : null}
          </NavLink>
        ))}
      </nav>
      <Suspense fallback={<Skeleton className="h-96" rounded="rounded-[20px]" />}>
        <Routes>
          <Route index element={<Inbox />} />
          <Route path="c/:id" element={<Inbox />} />
          <Route path="templates" element={<Templates />} />
          <Route path="consent" element={<Consents />} />
          <Route path="log" element={<MessageLog />} />
          <Route path="*" element={<Inbox />} />
        </Routes>
      </Suspense>
    </div>
  );
}

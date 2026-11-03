/**
 * Mounted once by the app shell (AppShell.tsx): diagnostics capture, the walkie-talkie runtime for the signed-in member,
 * the floating push-to-talk button (manager, waiter, kitchen/chef, delivery) and toasts for incoming radio clips + alerts.
 */
import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useDb } from "@/data/hooks";
import { useSession } from "@/auth/session";
import type { Role } from "@/auth/roles";
import { useT } from "@/i18n/i18n";
import { useToast } from "@/ui";
import { installDiagnostics } from "./support/diagnostics";
import { radio, useRadioEngine } from "./radio/engine";
import { PttButton, usePttNotices } from "./radio/PttButton";
import { channelDef, dmPeer, isDm } from "./radio/channels";
import { useOpsSettings } from "./settings";
import type { RadioChannelId } from "./types";
import { useAlertToasts } from "./alerts/useAlerts";
import { recorderSupported } from "./radio/recorder";

installDiagnostics();

export const FAB_ROLES: Role[] = ["manager", "waiter", "kitchen", "chef", "delivery"];
const FAB_CHANNEL: Partial<Record<Role, RadioChannelId>> = { manager: "floor", waiter: "floor", kitchen: "kitchen", chef: "kitchen", delivery: "delivery" };
const HIDE_ON = ["/radio", "/driver"];

function RadioRuntime() {
  const db = useDb();
  const { staff, role } = useSession();
  const { cfg } = useOpsSettings();
  const { L, loc } = useT();
  const { toast } = useToast();
  const nav = useNavigate();
  const snap = useRadioEngine();
  useEffect(() => {
    if (!staff) return;
    radio.attach({ db, me: staff.id, name: staff.name, role, config: { minMs: cfg.radio.minClipMs, maxMs: cfg.radio.maxClipSec * 1000, autoplay: cfg.radio.autoplay } });
  }, [db, staff, role, cfg.radio.minClipMs, cfg.radio.maxClipSec, cfg.radio.autoplay]);
  useEffect(() => () => radio.detach(), []);

  useEffect(
    () =>
      radio.onIncoming((clip) => {
        const ch = isDm(clip.channel) ? L("ليك", "to you") : loc(channelDef(clip.channel)?.name);
        if (location.pathname.endsWith("/radio")) return;
        toast({ title: `📻 ${clip.fromName} · ${ch}`, description: clip.text ?? L("رسالة صوتية", "Voice message"), duration: 3500, action: { label: L("افتح", "Open"), onClick: () => nav(`/radio?ch=${encodeURIComponent(clip.channel)}`) } });
      }),
    [L, loc, toast, nav],
  );
  const blockedShown = useRef(0);
  useEffect(() => {
    if (snap.blocked && snap.blocked !== blockedShown.current) {
      blockedShown.current = snap.blocked;
      toast({ title: L("رسالة لاسلكي مستنية", "Radio message waiting"), description: L("المتصفح منع التشغيل التلقائي — دوس شغّل", "The browser blocked auto-play — tap Play"), tone: "warn", action: { label: L("شغّل", "Play"), onClick: () => radio.playBlocked() } });
    }
  }, [snap.blocked, L, toast]);
  return null;
}

function PttFab() {
  const { role, staff, can } = useSession();
  const { L, loc } = useT();
  const loc0 = useLocation();
  const snap = useRadioEngine();
  usePttNotices();
  const channel: RadioChannelId = (role && FAB_CHANNEL[role]) || "all";
  const hidden = !role || !FAB_ROLES.includes(role) || !can("radio.use") || HIDE_ON.some((p) => loc0.pathname.startsWith(p)) || !recorderSupported();
  const label = useMemo(() => loc(channelDef(channel)?.name), [channel, loc]);
  if (hidden || !staff) return null;
  const incoming = snap.onAir.find((a) => a.who !== staff.id && (a.channel === channel || (isDm(a.channel) && dmPeer(a.channel, staff.id))));
  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] end-4 z-40 flex flex-col items-center gap-1.5 md:hidden" data-ptt-fab>
      {incoming ? <span className="max-w-36 truncate rounded-full bg-danger px-2.5 py-1 text-[11.5px] font-bold text-white shadow-sf">{incoming.name}</span> : null}
      <PttButton channel={channel} size="fab" label={L(`اضغط واتكلم — ${label}`, `Hold to talk — ${label}`)} />
      <Link to={`/radio?ch=${channel}`} className="rounded-full bg-surface px-2.5 py-0.5 text-[11.5px] font-semibold text-muted shadow-sf-sm">
        {label}
      </Link>
    </div>
  );
}

/** md+ : a hold-to-talk pill in the top bar instead of a floating button over the content. */
export function OpsTopBarPtt() {
  const { role, staff, can } = useSession();
  const { loc } = useT();
  if (!role || !staff || !FAB_ROLES.includes(role) || !can("radio.use") || !recorderSupported()) return null;
  const channel: RadioChannelId = FAB_CHANNEL[role] || "all";
  return (
    <div className="me-1 hidden md:flex" data-ptt-topbar>
      <PttButton channel={channel} size="pill" label={loc(channelDef(channel)?.name)} />
    </div>
  );
}

export function OpsShellExtras() {
  const { staff, restaurant, role } = useSession();
  if (!staff || !restaurant || role === "platform_admin") return null;
  return (
    <>
      <RadioRuntime />
      <AlertToasts />
      <PttFab />
    </>
  );
}

function AlertToasts() {
  useAlertToasts();
  return null;
}

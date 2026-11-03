/** /radio — walkie-talkie: channels, hold-to-talk, quick messages, clip history, who's on air, auto-play settings. */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { MessageSquareText, Play, RadioTower, Square, Users, Volume2, VolumeX, Zap } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { ago, clock } from "@/lib/time";
import { cn } from "@/lib/cn";
import { loadRaw, saveRaw } from "@/lib/storage";
import { PageHeader } from "@/shell/PageHeader";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Input, Switch, useToast } from "@/ui";
import type { RadioChannelId, RadioClip } from "../types";
import { CANNED, channelDef, channelsFor, dmId, dmPeer, isDm } from "./channels";
import { radio, useRadioEngine } from "./engine";
import { PttButton, usePttNotices } from "./PttButton";
import { useRecentClips, useUnread } from "./useClips";
import { recorderSupported } from "./recorder";

const CH_KEY = "sufra-os.radio.channel";

export default function RadioPage() {
  const { staff, role } = useSession();
  const { L, loc, lang } = useT();
  const { toast } = useToast();
  const snap = useRadioEngine();
  usePttNotices();
  const [params, setParams] = useSearchParams();
  const groups = channelsFor(role);
  const members = useLive("memberships", { where: { active: true } }).data.filter((m) => m.id !== staff?.id && m.role !== "platform_admin");
  const initial = (params.get("ch") as RadioChannelId | null) ?? (loadRaw(CH_KEY) as RadioChannelId | null) ?? groups[0]?.id ?? "all";
  const [channel, setChannel] = useState<RadioChannelId>(initial);
  const [dmOpen, setDmOpen] = useState(false);
  const [tableNo, setTableNo] = useState("");
  const clips = useRecentClips();
  const unread = useUnread();
  const me = staff?.id ?? "";

  useEffect(() => {
    saveRaw(CH_KEY, channel);
    radio.markRead(channel);
    if (params.get("ch") !== channel) setParams({ ch: channel }, { replace: true });
  }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => clips.data.filter((c) => c.channel === channel).slice(0, 60), [clips.data, channel]);
  useEffect(() => {
    if (list[0]) radio.markRead(channel);
  }, [list[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? (id === me ? staff?.name ?? "" : "");
  const chName = (id: string) => (isDm(id) ? nameOf(dmPeer(id, me) ?? "") || L("محادثة", "Direct") : loc(channelDef(id)?.name));
  const recentDms = useMemo(() => [...new Set(clips.data.filter((c) => isDm(c.channel) && dmPeer(c.channel, me)).map((c) => c.channel))].slice(0, 6), [clips.data, me]);
  const onAirHere = snap.onAir.filter((a) => a.channel === channel && a.who !== me);
  const supported = recorderSupported();

  const sendCanned = async (c: (typeof CANNED)[number]) => {
    if (c.needsTable && !tableNo.trim()) {
      toast({ title: L("اكتب رقم الطاولة الأول", "Type the table number first"), tone: "warn" });
      return;
    }
    const text = loc(c.text).replace("{t}", tableNo.trim());
    const target = isDm(channel) ? channel : groups.some((g) => g.id === c.channel) ? c.channel : channel;
    await radio.sendText(target, text);
    if (target !== channel) setChannel(target);
    toast({ title: L("اتبعتت", "Sent"), description: text, tone: "success", duration: 1600 });
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader
        icon={<RadioTower />}
        title={L("واكي توكي", "Walkie-talkie")}
        subtitle={L("اضغط مطوّل على الزرار واتكلم — سيب علشان تبعت", "Hold the button and talk — release to send")}
        actions={
          snap.unlocked ? (
            <Badge tone="ok" icon={<Volume2 className="size-3.5" />}>{L("الصوت شغّال", "Audio on")}</Badge>
          ) : (
            <Button size="sm" variant="soft" icon={<VolumeX className="size-4" />} onClick={() => radio.unlock()}>
              {L("فعّل الصوت", "Enable audio")}
            </Button>
          )
        }
      />

      {snap.blocked ? (
        <Card className="flex items-center gap-3 border-warn/40 bg-warn-soft p-3">
          <Volume2 className="size-5 text-warn" />
          <p className="flex-1 text-[14px] font-semibold">{L(`${snap.blocked} رسالة مستنية — المتصفح منع التشغيل التلقائي`, `${snap.blocked} waiting — the browser blocked auto-play`)}</p>
          <Button size="sm" onClick={() => radio.playBlocked()} icon={<Play className="size-4" />}>{L("شغّل", "Play")}</Button>
        </Card>
      ) : null}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar" role="tablist" aria-label={L("القنوات", "Channels")}>
        {groups.map((g) => (
          <ChannelChip key={g.id} active={channel === g.id} color={g.color} label={loc(g.name)} unread={unread[g.id] ?? 0} onAir={snap.onAir.some((a) => a.channel === g.id && a.who !== me)} onClick={() => setChannel(g.id)} />
        ))}
        {recentDms.map((d) => (
          <ChannelChip key={d} active={channel === d} color="#5b6a64" label={chName(d)} unread={unread[d] ?? 0} onAir={snap.onAir.some((a) => a.channel === d)} onClick={() => setChannel(d as RadioChannelId)} />
        ))}
        <button type="button" onClick={() => setDmOpen(true)} className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-4 text-[14px] font-semibold text-muted hover:text-ink">
          <Users className="size-4" /> {L("شخص", "Person")}
        </button>
      </div>

      <Card className="grid place-items-center gap-4 p-6">
        <div className="flex items-center gap-2 text-[15px] font-bold">
          <span className="size-2.5 rounded-full" style={{ background: isDm(channel) ? "#5b6a64" : channelDef(channel)?.color }} />
          {chName(channel)}
          {onAirHere.length ? <Badge tone="danger" pulse dot>{onAirHere.map((a) => a.name).join("، ")} {L("على الهوا", "on air")}</Badge> : null}
        </div>
        {supported ? <PttButton channel={channel} /> : <EmptyState compact icon={<RadioTower />} title={L("الجهاز ده مش بيدعم التسجيل", "This device can't record")} body={L("تقدر تبعت رسايل جاهزة وتسمع.", "You can still send quick messages and listen.")} />}
        <p className="text-center text-[12.5px] text-muted">
          {L(`أقل من ${(snap.config.minMs / 1000).toFixed(1)} ثانية بيتلغي · أقصى مدة ${Math.round(snap.config.maxMs / 1000)} ثانية · مسافة = اضغط واتكلم`, `Under ${(snap.config.minMs / 1000).toFixed(1)}s is discarded · max ${Math.round(snap.config.maxMs / 1000)}s · Space = push to talk`)}
        </p>
      </Card>

      <Card className="grid gap-3 p-4">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-brass" />
          <p className="flex-1 text-[14px] font-bold">{L("رسايل سريعة", "Quick messages")}</p>
          <Input aria-label={L("رقم الطاولة", "Table no.")} placeholder={L("طاولة", "Table")} inputMode="numeric" value={tableNo} onChange={(e) => setTableNo(e.target.value)} wrapClassName="w-28" />
        </div>
        <div className="flex flex-wrap gap-2">
          {CANNED.filter((c) => isDm(channel) || groups.some((g) => g.id === c.channel)).map((c) => (
            <button key={c.id} type="button" onClick={() => void sendCanned(c)} className="rounded-full border border-line bg-surface-2 px-3.5 py-2 text-[13.5px] font-semibold hover:border-line-strong">
              {loc(c.text).replace("{t}", tableNo.trim() || (lang === "ar" ? "…" : "…"))}
            </button>
          ))}
        </div>
      </Card>

      <section className="grid gap-2" aria-label={L("السجل", "History")}>
        <h2 className="px-1 text-[15px] font-bold">{L("آخر الرسايل", "Recent")}</h2>
        {!list.length ? <EmptyState compact icon={<MessageSquareText />} title={L("لسه مفيش رسايل هنا", "No messages here yet")} /> : null}
        <AnimatePresence initial={false}>
          {list.map((c) => (
            <motion.div key={c.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
              <ClipRow clip={c} mine={c.fromId === me} playing={snap.playing === c.id} />
            </motion.div>
          ))}
        </AnimatePresence>
      </section>

      <Card className="grid gap-2 p-4">
        <p className="text-[14px] font-bold">{L("يشتغل لوحده على", "Auto-play on")}</p>
        {groups.map((g) => (
          <Switch
            key={g.id}
            checked={snap.monitored.includes(g.id)}
            onChange={(v) => radio.setMonitored(v ? [...snap.monitored, g.id] : snap.monitored.filter((x) => x !== g.id))}
            label={loc(g.name)}
          />
        ))}
        <p className="text-[12.5px] text-muted">{L("الرسايل المباشرة ليك بتشتغل دايماً. أول لمسة على الشاشة بتسمح للمتصفح يشغّل الصوت.", "Direct messages always play. Your first tap on the screen lets the browser play audio.")}</p>
      </Card>

      <Dialog open={dmOpen} onClose={() => setDmOpen(false)} title={L("كلّم شخص", "Talk to a person")} size="sm">
        <div className="grid max-h-[60dvh] gap-1 overflow-y-auto">
          {members.map((m) => (
            <button key={m.id} type="button" className="flex items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-surface-2" onClick={() => (setChannel(dmId(me, m.id)), setDmOpen(false))}>
              <Avatar name={m.name} color={m.color} size="sm" />
              <span className="flex-1 text-[14.5px] font-semibold">{m.name}</span>
              {snap.onAir.some((a) => a.who === m.id) ? <Badge tone="danger" size="sm">{L("بيتكلم", "talking")}</Badge> : null}
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

function ChannelChip({ active, color, label, unread, onAir, onClick }: { active: boolean; color: string; label: string; unread: number; onAir: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("relative flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[14.5px] font-semibold transition-colors", active ? "border-transparent bg-ink text-bg" : "border-line bg-surface hover:border-line-strong")}
    >
      <span className={cn("size-2.5 rounded-full", onAir && "animate-pulse")} style={{ background: onAir ? "var(--sf-danger)" : color }} />
      {label}
      {unread ? <span className="num grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11.5px] font-bold text-white">{unread}</span> : null}
    </button>
  );
}

function ClipRow({ clip, mine, playing }: { clip: RadioClip; mine: boolean; playing: boolean }) {
  const { L, lang } = useT();
  return (
    <div data-clip={clip.id} className={cn("flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5", mine && "bg-primary-soft/40")}>
      <Avatar name={clip.fromName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">
          {mine ? L("أنت", "You") : clip.fromName}
          <span className="ms-2 text-[12px] font-normal text-muted">{clock(clip.at, lang)} · {ago(clip.at, lang)}</span>
        </p>
        {clip.text ? <p className="text-[14px] text-ink-2">{clip.text}</p> : <p className="num text-[12.5px] text-muted">🎙 {(clip.durationMs / 1000).toFixed(1)}s</p>}
      </div>
      <Button size="sm" variant={playing ? "danger" : "secondary"} aria-label={playing ? L("وقّف", "Stop") : L("شغّل", "Play")} icon={playing ? <Square className="size-4" /> : <Play className="size-4" />} onClick={() => (playing ? radio.stopPlayback() : radio.playNow(clip))}>
        {playing ? L("وقّف", "Stop") : L("شغّل", "Play")}
      </Button>
    </div>
  );
}

/** POS ↔ video exceptions: filters, per-event cameras, open clip at the timestamp, review verdict. */
import { useMemo, useState } from "react";
import { Ban, Banknote, Check, Copy, ExternalLink, Flag, PackageOpen, Percent, PlayCircle, Scale, Undo2, UtensilsCrossed, VideoOff } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { clock, dayLabel } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, Dialog, EmptyState, Select, Switch, useToast } from "@/ui";
import type { Camera, OpsAck } from "../types";
import { camerasFor, EVENT_KINDS, filterEvents, type VideoEvent, type VideoEventKind } from "./events";
import { isBrowserUrl, playbackUrl, PLAYBACK_PATTERNS } from "./nvr";
import { useVideoEvents } from "./useEvents";
import { CameraPlayer } from "./CameraTile";
import { useOpsSettings } from "../settings";
import { copyText, KV } from "../ui";

export const KIND_META: Record<VideoEventKind, { icon: typeof Ban; ar: string; en: string }> = {
  void: { icon: Ban, ar: "إلغاء", en: "Void" },
  refund: { icon: Undo2, ar: "مرتجع", en: "Refund" },
  discount: { icon: Percent, ar: "خصم فوق الحد", en: "Discount over limit" },
  no_sale: { icon: PackageOpen, ar: "فتح درج بدون بيع", en: "No-sale drawer" },
  cash_variance: { icon: Scale, ar: "عجز / زيادة", en: "Cash over/short" },
  item_86: { icon: UtensilsCrossed, ar: "86 يدوي", en: "Manual 86" },
};

export default function EventsView() {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { branchId } = useSession();
  const [days, setDays] = useState(7);
  const { events } = useVideoEvents(days);
  const cams = useLive("cameras", { where: branchId ? { branchId } : {} }).data;
  const members = useLive("memberships").data;
  const acks = useLive("opsAcks", { where: { kind: "event" } }).data;
  const ackBy = useMemo(() => new Map(acks.map((a) => [a.id, a])), [acks]);
  const [kinds, setKinds] = useState<VideoEventKind[]>([]);
  const [device, setDevice] = useState("");
  const [actor, setActor] = useState("");
  const [unreviewed, setUnreviewed] = useState(false);
  const [clip, setClip] = useState<VideoEvent | null>(null);
  const name = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "—" : "—");
  const devices = [...new Set(events.map((e) => e.device).filter(Boolean) as string[])];
  const list = filterEvents(events, { kinds, device: device || null, actorId: actor || null, unreviewed }, new Set(ackBy.keys()));
  const counts = useMemo(() => {
    const m = new Map<VideoEventKind, number>();
    for (const e of events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [events]);

  const review = async (e: VideoEvent, verdict: OpsAck["verdict"]) => {
    const cur = ackBy.get(e.id);
    if (cur) await db.update("opsAcks", e.id, { verdict, by: db.actorId });
    else await db.insert("opsAcks", { id: e.id, kind: "event", by: db.actorId, note: "", verdict });
    await db.audit("camera.review", "auditLog", e.id, { verdict, kind: e.kind });
    toast({ title: verdict === "suspicious" ? L("اتعلّم مشبوه", "Flagged") : L("اتراجع", "Reviewed"), tone: verdict === "suspicious" ? "warn" : "success", duration: 1500 });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {EVENT_KINDS.map((k) => {
          const M = KIND_META[k];
          const on = kinds.includes(k);
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])} className={cn("flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold", on ? "border-transparent bg-ink text-bg" : "border-line bg-surface")}>
              <M.icon className="size-4" /> {lang === "ar" ? M.ar : M.en}
              <span className="num text-[12px] opacity-70">{counts.get(k) ?? 0}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={L("الفترة", "Period")} value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[{ value: "1", label: L("النهارده", "Today") }, { value: "7", label: L("آخر ٧ أيام", "Last 7 days") }, { value: "30", label: L("آخر ٣٠ يوم", "Last 30 days") }]} />
        <Select aria-label={L("الجهاز", "Device")} value={device} onChange={(e) => setDevice(e.target.value)} options={[{ value: "", label: L("كل الأجهزة", "All devices") }, ...devices.map((d) => ({ value: d, label: d }))]} />
        <Select aria-label={L("الموظف", "Staff")} value={actor} onChange={(e) => setActor(e.target.value)} options={[{ value: "", label: L("كل الموظفين", "All staff") }, ...members.filter((m) => m.role !== "platform_admin").map((m) => ({ value: m.id, label: m.name }))]} />
        <div className="ms-auto">
          <Switch checked={unreviewed} onChange={setUnreviewed} label={L("اللي ما اتراجعش بس", "Unreviewed only")} />
        </div>
      </div>
      {!list.length ? <EmptyState compact icon={<VideoOff />} title={L("مفيش استثناءات", "No exceptions")} body={L("الإلغاءات والمرتجعات والخصومات الكبيرة وفتح الدرج بتظهر هنا لوحدها.", "Voids, refunds, large discounts and drawer opens appear here automatically.")} /> : null}
      <div className="grid gap-2">
        {list.map((e) => {
          const M = KIND_META[e.kind];
          const cs = camerasFor(e, cams);
          const ack = ackBy.get(e.id);
          return (
            <Card key={e.id} data-event={e.kind} className="flex flex-wrap items-center gap-3 p-3">
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", e.severity === "high" ? "bg-danger-soft text-danger" : e.severity === "warn" ? "bg-warn-soft text-warn" : "bg-surface-3 text-ink-2")}>
                <M.icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-[14.5px] font-bold">
                  {lang === "ar" ? M.ar : M.en}
                  {e.amount ? <span className="num ms-2 font-semibold text-ink-2">{formatMoney(e.signed ?? e.amount, { lang, signed: e.signed != null })}</span> : null}
                  {e.reason ? <span className="ms-2 font-normal text-muted">— {e.reason}</span> : null}
                </p>
                <p className="text-[12.5px] text-muted">
                  <span className="num">{dayLabel(e.at, lang)} {clock(e.at, lang)}</span> · <span className="font-mono">{e.device ?? L("جهاز غير معروف", "unknown device")}</span> · {name(e.actorId)}
                  {e.approvedBy ? <> · {L("وافق", "approved by")} {name(e.approvedBy)}</> : null}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {cs.length ? cs.map((c) => <Badge key={c.id} size="sm" tone="info">📹 {lang === "ar" ? c.name.ar : c.name.en}</Badge>) : <Badge size="sm" tone="warn">{L("مفيش كاميرا مربوطة بالجهاز ده", "No camera linked to this device")}</Badge>}
                  {ack ? <Badge size="sm" tone={ack.verdict === "suspicious" ? "danger" : "ok"} icon={ack.verdict === "suspicious" ? <Flag className="size-3" /> : <Check className="size-3" />}>{ack.verdict === "suspicious" ? L("مشبوه", "Suspicious") : L("اتراجع", "Reviewed")}</Badge> : null}
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" icon={<PlayCircle className="size-4" />} disabled={!cs.length} onClick={() => setClip(e)}>{L("افتح الكليب", "Open clip")}</Button>
                <Button size="sm" variant="secondary" aria-label={L("تمام", "OK")} icon={<Check className="size-4" />} onClick={() => void review(e, "ok")} />
                <Button size="sm" variant="secondary" aria-label={L("مشبوه", "Suspicious")} icon={<Flag className="size-4" />} onClick={() => void review(e, "suspicious")} />
              </div>
            </Card>
          );
        })}
      </div>
      <ClipDialog ev={clip} cams={clip ? camerasFor(clip, cams) : []} onClose={() => setClip(null)} />
    </div>
  );
}

function ClipDialog({ ev, cams, onClose }: { ev: VideoEvent | null; cams: Camera[]; onClose: () => void }) {
  const { L, lang } = useT();
  const { cfg } = useOpsSettings();
  const { restaurant } = useSession();
  const { toast } = useToast();
  const [i, setI] = useState(0);
  const cam = cams[Math.min(i, cams.length - 1)];
  if (!ev || !cam) return null;
  const url = playbackUrl({ brand: cam.brand, channel: cam.channel, host: cfg.nvrHost || "NVR_HOST:554", gateway: cfg.gatewayUrl || "http://GATEWAY:9996", timeZone: restaurant?.timezone, template: cfg.playbackTemplates[cam.brand], window: { at: ev.at, padSec: cfg.clipPadSec } });
  const pat = PLAYBACK_PATTERNS[cam.brand];
  const demo = cam.stream === "demo";
  return (
    <Dialog open onClose={onClose} title={L("كليب الحدث", "Event clip")} description={`${clock(ev.at, lang)} · ±${cfg.clipPadSec}s · ${ev.device ?? ""}`} size="lg">
      <div className="grid gap-3">
        {cams.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {cams.map((c, k) => (
              <Button key={c.id} size="sm" variant={k === i ? "primary" : "secondary"} onClick={() => setI(k)}>{lang === "ar" ? c.name.ar : c.name.en}</Button>
            ))}
          </div>
        ) : null}
        {demo ? (
          <div>
            <div className="aspect-video overflow-hidden rounded-2xl">
              <CameraPlayer cam={cam} at={Date.parse(ev.at) - cfg.clipPadSec * 1000} />
            </div>
            <p className="mt-1 text-[12.5px] text-muted">{L("كاميرا تجريبية: ده رسم توضيحي بالوقت بتاع الحدث، مش تسجيل حقيقي. مع NVR حقيقي الرابط اللي تحت بيفتح التسجيل.", "Demo camera: an illustration at the event time, not a recording. With a real NVR the link below opens the recording.")}</p>
          </div>
        ) : null}
        <Card className="grid gap-1 p-3">
          <KV k={L("الطريقة", "Pattern")} v={pat.label} />
          <KV k={L("التأكيد", "Confidence")} v={pat.confidence === "documented" ? L("موثّق من الشركة", "Vendor-documented") : L("من تجارب المستخدمين — جرّبه على جهازك", "Community-reported — test on your firmware")} />
          <p className="break-all rounded-lg bg-surface-2 p-2 font-mono text-[12px]" dir="ltr" data-clip-url>{url}</p>
          <p className="text-[12px] text-muted">{pat.note}</p>
        </Card>
        <div className="flex flex-wrap gap-2">
          {isBrowserUrl(url) ? (
            <Button icon={<ExternalLink className="size-4" />} onClick={() => window.open(url, "_blank", "noopener")}>{L("افتح في المتصفح", "Open in browser")}</Button>
          ) : (
            <Badge tone="warn">{L("رابط RTSP — افتحه في VLC أو برنامج الـ NVR أو عن طريق البوابة", "RTSP link — open in VLC, the NVR client or via the gateway")}</Badge>
          )}
          <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => copyText(url) && toast({ title: L("اتنسخ", "Copied"), duration: 1200 })}>{L("انسخ الرابط", "Copy link")}</Button>
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-muted"><Banknote className="size-3.5" /> {L("الباسورد عمره ما بيتحط في الرابط — بيتخزن على البوابة أو الـ NVR بس.", "Passwords never go into the link — they live on the gateway / NVR only.")}</p>
      </div>
    </Dialog>
  );
}

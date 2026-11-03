/** Camera registry per branch + NVR / gateway settings + a generated go2rtc config for the on-site gateway. */
import { useMemo, useState } from "react";
import { Copy, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { Badge, Button, Card, CardHeader, Dialog, Input, Select, Switch, Textarea, useToast } from "@/ui";
import type { Camera, NvrBrand, StreamKind } from "../types";
import { PLAYBACK_PATTERNS, rtspLivePath } from "./nvr";
import { useOpsSettings, useSaveOps } from "../settings";
import { copyText } from "../ui";
import { StatusChip, statusOf } from "./CameraTile";

const BRANDS: { value: NvrBrand; label: string }[] = [
  { value: "hikvision", label: "Hikvision" },
  { value: "dahua", label: "Dahua" },
  { value: "uniview", label: "Uniview" },
  { value: "other", label: "Other / MediaMTX" },
];

type Draft = Omit<Camera, "id" | "restaurantId" | "createdAt" | "updatedAt"> & { id?: string };

export default function SetupView() {
  const { L, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { branchId, can } = useSession();
  const cams = useLive("cameras", { where: branchId ? { branchId } : {}, orderBy: [{ field: "sort" }] }).data;
  const [edit, setEdit] = useState<Draft | null>(null);
  const editable = can("settings.edit");
  const blank = (): Draft => ({ branchId: branchId ?? "", name: { ar: "", en: "" }, area: "", zoneId: null, brand: "hikvision", channel: cams.length + 1, stream: "demo", url: "", snapshotSec: 2, posDevices: [], tableIds: [], drawers: [], counter: false, active: true, sort: cams.length + 1 });

  const remove = async (c: Camera) => {
    await db.remove("cameras", c.id);
    await db.audit("camera.delete", "cameras", c.id, { name: c.name.en });
    toast({ title: L("اتمسحت", "Removed"), duration: 1200 });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="grid content-start gap-2">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[15px] font-bold">{L(`كاميرات الفرع (${cams.length})`, `Branch cameras (${cams.length})`)}</p>
          {editable ? <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit(blank())}>{L("كاميرا جديدة", "New camera")}</Button> : null}
        </div>
        {cams.map((c) => (
          <Card key={c.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="num grid size-10 place-items-center rounded-xl bg-surface-3 font-mono text-[13px] font-bold">{c.channel}</span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="flex items-center gap-2 text-[14.5px] font-bold">{loc(c.name)} <StatusChip s={statusOf(c, null)} /></p>
              <p className="text-[12.5px] text-muted">
                {BRANDS.find((b) => b.value === c.brand)?.label} · {c.stream.toUpperCase()} · {c.area || "—"}
                {c.posDevices.length ? <> · POS: <span className="font-mono">{c.posDevices.join(", ")}</span></> : null}
                {c.tableIds.length ? <> · {L(`${c.tableIds.length} طاولة`, `${c.tableIds.length} tables`)}</> : null}
                {c.counter ? <> · {L("عدّاد", "counter")}</> : null}
              </p>
            </div>
            {editable ? (
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" aria-label={L("تعديل", "Edit")} icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...c })} />
                <Button size="sm" variant="secondary" aria-label={L("امسح", "Delete")} icon={<Trash2 className="size-4" />} onClick={() => void remove(c)} />
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <GatewayCard cams={cams} />
      {edit ? <CameraDialog draft={edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function CameraDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { L, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [d, setD] = useState<Draft>(draft);
  const tables = useLive("tables", { where: { branchId: d.branchId } }).data;
  const zones = useLive("zones", { where: { branchId: d.branchId } }).data;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const list = (s: string) => s.split(/[,،\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const save = async () => {
    if (!d.name.ar.trim() && !d.name.en.trim()) return toast({ title: L("اكتب اسم الكاميرا", "Name the camera"), tone: "warn" });
    const row = { ...d, name: { ar: d.name.ar || d.name.en, en: d.name.en || d.name.ar } };
    const { id, ...rest } = row;
    if (id) await db.update("cameras", id, rest);
    else await db.insert("cameras", rest);
    await db.audit(id ? "camera.update" : "camera.create", "cameras", id ?? null, { name: row.name.en, brand: row.brand, stream: row.stream });
    toast({ title: L("اتحفظت", "Saved"), tone: "success", duration: 1200 });
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title={d.id ? L("تعديل كاميرا", "Edit camera") : L("كاميرا جديدة", "New camera")} size="lg" footer={<Button onClick={() => void save()}>{L("احفظ", "Save")}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={L("الاسم (عربي)", "Name (Arabic)")} value={d.name.ar} onChange={(e) => set("name", { ...d.name, ar: e.target.value })} />
        <Input label={L("الاسم (إنجليزي)", "Name (English)")} value={d.name.en} onChange={(e) => set("name", { ...d.name, en: e.target.value })} />
        <Input label={L("المكان", "Area")} value={d.area} onChange={(e) => set("area", e.target.value)} placeholder={L("الكاشير، المطبخ…", "Cashier, kitchen…")} />
        <Select label={L("منطقة الصالة", "Floor zone")} value={d.zoneId ?? ""} onChange={(e) => set("zoneId", e.target.value || null)} options={[{ value: "", label: "—" }, ...zones.map((z) => ({ value: z.id, label: loc(z.name) }))]} />
        <Select label={L("نوع الـ NVR", "NVR brand")} value={d.brand} onChange={(e) => set("brand", e.target.value as NvrBrand)} options={BRANDS} />
        <Input label={L("رقم القناة", "Channel")} type="number" min={1} value={d.channel} onChange={(e) => set("channel", Math.max(1, Number(e.target.value) || 1))} />
        <Select
          label={L("طريقة العرض", "Stream type")}
          value={d.stream}
          onChange={(e) => set("stream", e.target.value as StreamKind)}
          options={[
            { value: "demo", label: L("تجريبي (رسم متحرك)", "Demo (animated placeholder)") },
            { value: "hls", label: "HLS (.m3u8)" },
            { value: "webrtc", label: L("WebRTC (صفحة go2rtc / MediaMTX)", "WebRTC (go2rtc / MediaMTX page)") },
            { value: "mjpeg", label: "MJPEG" },
            { value: "snapshot", label: L("صورة كل كام ثانية", "Snapshot polling") },
          ]}
        />
        {d.stream === "snapshot" ? <Input label={L("كل كام ثانية", "Every (seconds)")} type="number" min={1} value={d.snapshotSec} onChange={(e) => set("snapshotSec", Math.max(1, Number(e.target.value) || 2))} /> : <span />}
        {d.stream !== "demo" ? <Input wrapClassName="sm:col-span-2" label={L("رابط البث (للمتصفح)", "Browser stream URL")} dir="ltr" value={d.url} onChange={(e) => set("url", e.target.value)} placeholder="https://cams.example.com/api/stream.m3u8?src=cashier" hint={L("مش rtsp:// — المتصفح ما بيشغّلوش. من غير باسورد في الرابط.", "Not rtsp:// — browsers can't play it. No passwords in the URL.")} /> : null}
        <Input label={L("أجهزة الكاشير اللي باينة", "POS devices in view")} dir="ltr" value={d.posDevices.join(", ")} onChange={(e) => set("posDevices", list(e.target.value))} placeholder="POS1, KDS, RIDER" />
        <Input label={L("الأدراج", "Drawers")} dir="ltr" value={d.drawers.join(", ")} onChange={(e) => set("drawers", list(e.target.value))} placeholder="POS1" />
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13.5px] font-semibold">{L("الطاولات اللي باينة", "Tables in view")}</p>
          <div className="flex flex-wrap gap-1.5">
            {tables.map((t) => {
              const on = d.tableIds.includes(t.id);
              return (
                <button key={t.id} type="button" aria-pressed={on} onClick={() => set("tableIds", on ? d.tableIds.filter((x) => x !== t.id) : [...d.tableIds, t.id])} className={"num h-9 min-w-10 rounded-lg border px-2 text-[13px] font-semibold " + (on ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface")}>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <Switch checked={d.counter} onChange={(v) => set("counter", v)} label={L("بتعدّ الناس (مدخل)", "Counts people (entrance)")} />
        <Switch checked={d.active} onChange={(v) => set("active", v)} label={L("شغّالة", "Active")} />
      </div>
    </Dialog>
  );
}

function GatewayCard({ cams }: { cams: Camera[] }) {
  const { L } = useT();
  const { cfg } = useOpsSettings();
  const save = useSaveOps();
  const { toast } = useToast();
  const { can } = useSession();
  const [gw, setGw] = useState<string | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [pad, setPad] = useState<number | null>(null);
  const [tpl, setTpl] = useState<Partial<Record<NvrBrand, string>> | null>(null);
  const t = tpl ?? cfg.playbackTemplates;
  const yaml = useMemo(() => {
    const lines = ["# go2rtc.yaml — runs on a small PC / Raspberry Pi on the restaurant LAN", "streams:"];
    for (const c of cams) lines.push(`  cam${c.channel}: rtsp://USER:PASS@${(host ?? cfg.nvrHost) || "192.168.1.64:554"}${rtspLivePath(c.brand, c.channel)}`);
    lines.push("api:", "  listen: \":1984\"", "  # put it behind HTTPS + auth (e.g. Cloudflare Tunnel / Tailscale Funnel) — never expose :1984 bare", "webrtc:", "  listen: \":8555\"");
    return lines.join("\n");
  }, [cams, host, cfg.nvrHost]);
  const doSave = async () => {
    await save({ gatewayUrl: (gw ?? cfg.gatewayUrl).trim(), nvrHost: (host ?? cfg.nvrHost).trim(), clipPadSec: pad ?? cfg.clipPadSec, playbackTemplates: t });
    toast({ title: L("اتحفظ", "Saved"), tone: "success", duration: 1200 });
  };
  return (
    <Card className="grid content-start gap-3 p-4">
      <CardHeader icon={<Server />} title={L("الـ NVR والبوابة", "NVR & gateway")} subtitle={L("علشان الفيديو يشتغل في المتصفح ويفتح التسجيلات", "So video plays in the browser and clips open")} />
      <Input label={L("عنوان الـ NVR في الشبكة", "NVR address on the LAN")} dir="ltr" value={host ?? cfg.nvrHost} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.64:554" />
      <Input label={L("رابط البوابة (go2rtc / MediaMTX)", "Gateway URL (go2rtc / MediaMTX)")} dir="ltr" value={gw ?? cfg.gatewayUrl} onChange={(e) => setGw(e.target.value)} placeholder="https://cams.myrestaurant.com" />
      <Input label={L("ثواني قبل/بعد الحدث", "Seconds before/after an event")} type="number" min={5} value={pad ?? cfg.clipPadSec} onChange={(e) => setPad(Math.max(5, Number(e.target.value) || 30))} />
      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-[13.5px] font-semibold">{L("قوالب روابط التسجيل", "Playback URL templates")}</summary>
        <div className="mt-2 grid gap-2">
          {BRANDS.map((b) => (
            <div key={b.value} className="grid gap-1">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                {b.label}
                <Badge size="sm" tone={PLAYBACK_PATTERNS[b.value].confidence === "documented" ? "ok" : "warn"}>{PLAYBACK_PATTERNS[b.value].confidence === "documented" ? L("موثّق", "documented") : L("غير مؤكد", "unconfirmed")}</Badge>
              </div>
              <Textarea dir="ltr" rows={2} className="font-mono text-[11.5px]" value={t[b.value] ?? ""} placeholder={PLAYBACK_PATTERNS[b.value].template} onChange={(e) => setTpl({ ...t, [b.value]: e.target.value })} />
            </div>
          ))}
        </div>
      </details>
      {can("settings.edit") ? <Button onClick={() => void doSave()}>{L("احفظ", "Save")}</Button> : null}
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[13.5px] font-bold">{L("إعداد البوابة في المطعم", "On-site gateway config")}</p>
          <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => copyText(yaml) && toast({ title: L("اتنسخ", "Copied"), duration: 1200 })}>{L("انسخ", "Copy")}</Button>
        </div>
        <pre className="max-h-56 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed" dir="ltr">{yaml}</pre>
        <p className="text-[12px] text-muted">{L("بعد كده حط لكل كاميرا: WebRTC = {البوابة}/stream.html?src=camN أو HLS = {البوابة}/api/stream.m3u8?src=camN. التفاصيل في DESIGN.md.", "Then per camera: WebRTC = {gateway}/stream.html?src=camN or HLS = {gateway}/api/stream.m3u8?src=camN. Details in DESIGN.md.")}</p>
      </div>
    </Card>
  );
}

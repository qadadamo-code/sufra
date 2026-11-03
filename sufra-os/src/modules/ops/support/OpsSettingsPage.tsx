/** /settings/ops — guest hotline + WhatsApp, Sufra support line, ticket SLAs, walkie-talkie limits. */
import { useEffect, useState } from "react";
import { Headset, PhoneCall, RadioTower, Timer } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { PageHeader } from "@/shell/PageHeader";
import { Button, Card, CardHeader, Input, LinkButton, Switch, useToast } from "@/ui";
import { useOpsSettings, useSaveOps, type OpsConfig } from "../settings";
import { PRIORITY_LABEL } from "./TicketDetail";
import { PRIORITIES } from "./tickets";
import { realtimeVoiceConfig } from "../radio/transport";

export default function OpsSettingsPage() {
  const { L, lang } = useT();
  const { cfg, loading } = useOpsSettings();
  const save = useSaveOps();
  const { toast } = useToast();
  const [d, setD] = useState<OpsConfig>(cfg);
  useEffect(() => setD(cfg), [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const rt = realtimeVoiceConfig(import.meta.env as unknown as Record<string, string | undefined>);
  const doSave = async () => {
    await save({ hotlinePhone: d.hotlinePhone.trim(), whatsappPhone: d.whatsappPhone.trim(), sla: d.sla, radio: d.radio });
    toast({ title: L("اتحفظ", "Saved"), tone: "success", duration: 1200 });
  };
  return (
    <div className="grid gap-4">
      <PageHeader icon={<Headset />} title={L("التشغيل والدعم", "Operations & support")} actions={<Button onClick={() => void doSave()}>{L("احفظ", "Save")}</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="grid content-start gap-3 p-4">
          <CardHeader icon={<PhoneCall />} title={L("الخط الساخن للضيوف", "Guest hotline")} subtitle={L("بيظهر في «كلّم المطعم» على صفحات الضيوف", "Shown on the guest “Contact the restaurant” sheet")} />
          <Input label={L("رقم التليفون", "Phone number")} dir="ltr" inputMode="tel" value={d.hotlinePhone} onChange={(e) => setD({ ...d, hotlinePhone: e.target.value })} hint={L("فاضي = رقم الفرع", "Empty = the branch phone")} />
          <Input label={L("رقم الواتساب", "WhatsApp number")} dir="ltr" inputMode="tel" value={d.whatsappPhone} onChange={(e) => setD({ ...d, whatsappPhone: e.target.value })} />
        </Card>
        <Card className="grid content-start gap-3 p-4">
          <CardHeader icon={<Headset />} title={L("دعم سُفرة الفني", "Sufra technical support")} />
          <Input label={L("الخط الساخن لسُفرة", "Sufra hotline")} dir="ltr" value={d.sufraSupportPhone} disabled placeholder={L("هيتعلن قريباً", "To be announced")} hint={L("بيتحدد من فريق سُفرة.", "Set by the Sufra team.")} />
          <LinkButton to="/help/request" variant="soft">{L("اطلب دعم", "Request support")}</LinkButton>
        </Card>
        <Card className="grid content-start gap-3 p-4">
          <CardHeader icon={<Timer />} title={L("أوقات الرد على الشكاوى (SLA)", "Complaint SLAs")} subtitle={L("بالدقايق — اللي يعدّي بيتصعّد ويظهر في التنبيهات", "Minutes — past due escalates and alerts")} />
          {PRIORITIES.map((p) => (
            <div key={p} className="grid grid-cols-[90px_1fr_1fr] items-end gap-2">
              <span className="pb-3 text-[14px] font-semibold">{PRIORITY_LABEL[p][lang]}</span>
              <Input label={L("أول رد", "First reply")} type="number" min={1} value={d.sla[p].response} onChange={(e) => setD({ ...d, sla: { ...d.sla, [p]: { ...d.sla[p], response: Math.max(1, Number(e.target.value) || 1) } } })} />
              <Input label={L("الحل", "Resolve")} type="number" min={1} value={d.sla[p].resolve} onChange={(e) => setD({ ...d, sla: { ...d.sla, [p]: { ...d.sla[p], resolve: Math.max(1, Number(e.target.value) || 1) } } })} />
            </div>
          ))}
        </Card>
        <Card className="grid content-start gap-3 p-4">
          <CardHeader icon={<RadioTower />} title={L("الواكي توكي", "Walkie-talkie")} />
          <Input label={L("أقصى مدة للرسالة (ثانية)", "Max clip length (s)")} type="number" min={5} max={120} value={d.radio.maxClipSec} onChange={(e) => setD({ ...d, radio: { ...d.radio, maxClipSec: Math.min(120, Math.max(5, Number(e.target.value) || 30)) } })} />
          <Input label={L("أقل مدة (ملي ثانية)", "Min clip length (ms)")} type="number" min={100} max={2000} value={d.radio.minClipMs} onChange={(e) => setD({ ...d, radio: { ...d.radio, minClipMs: Math.min(2000, Math.max(100, Number(e.target.value) || 400)) } })} />
          <Switch checked={d.radio.autoplay} onChange={(v) => setD({ ...d, radio: { ...d.radio, autoplay: v } })} label={L("تشغيل تلقائي للرسايل", "Auto-play incoming clips")} />
          <p className="text-[12.5px] text-muted">
            {rt.provider ? L(`صوت مباشر: ${rt.provider} ${rt.ready ? "جاهز" : "ناقص " + rt.missing.join(", ")}`, `Live voice: ${rt.provider} ${rt.ready ? "ready" : "missing " + rt.missing.join(", ")}`) : L("الرسايل بتتسجل وتتبعت (مش مكالمة مباشرة). الصوت المباشر (LiveKit / Agora / Zello) متاح كواجهة للتفعيل لاحقاً.", "Clips are recorded and delivered (store-and-forward). Live voice (LiveKit / Agora / Zello) is an adapter interface for later.")}
          </p>
        </Card>
      </div>
      <p className="text-[13px] text-muted">
        {L("قواعد التنبيهات (مين يتبلّغ بإيه) في ", "Alert rules (who is notified of what) are in ")}
        <LinkButton to="/alerts?tab=rules" variant="ghost" size="sm">{L("مركز التنبيهات", "the alerts center")}</LinkButton>
      </p>
    </div>
  );
}

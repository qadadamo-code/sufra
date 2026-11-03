/** /delivery/aggregators — Talabat / elmenus / HungerStation / Jahez / Keeta: what integration needs, and manual entry meanwhile. */
import { useState } from "react";
import { Cable, Info, Plug, Receipt, Workflow } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { Badge, Button, Card } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { AGGREGATORS } from "./aggregators";
import { AggregatorOrderDialog } from "./AggregatorOrderDialog";
import { DeliveryTabs } from "./ui";

export default function AggregatorsPage() {
  const { L, loc } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto grid max-w-[1200px] gap-5">
      <PageHeader
        icon={<Plug />}
        title={L("تطبيقات التوصيل", "Delivery apps")}
        subtitle={L("طلبات، المنيوز، هنقرستيشن، جاهز، كيتا", "Talabat, elmenus, HungerStation, Jahez, Keeta")}
        actions={
          <Button icon={<Receipt />} onClick={() => setOpen(true)}>
            {L("سجّل طلب تطبيق", "Key in an app order")}
          </Button>
        }
      />
      <DeliveryTabs />
      <Card className="flex items-start gap-3 border-info/30 bg-info-soft/50 p-4 text-[14px]">
        <Info className="mt-0.5 size-5 shrink-0 text-info" />
        <div className="grid gap-1.5">
          <p className="font-bold">{L("الربط المباشر محتاج تفعيل من التطبيق نفسه", "Direct integration has to be enabled by each app")}</p>
          <p className="text-ink-2">
            {L(
              "مفيش تطبيق منهم بيدّي API مفتوح لأي حد: الربط بيتفعّل من مدير حسابك عندهم (برنامج شركاء الـ POS) أو عن طريق وسيط زي Deliverect أو Foodizone أو Grubtech، وبعدها الطلبات بتوصل سُفرة لوحدها وبنرجّع لهم الحالة (اتقبل، جاهز، خرج). لحد ده ما يحصل، سجّل طلباتهم يدوي من هنا بالعمولة عشان المطبخ والتقارير يبقوا كاملين.",
              "None of them offers an open API: integration is enabled by your account manager (their POS-partner programme) or through a middleware such as Deliverect, Foodizone or Grubtech. Orders then arrive in Sufra on their own and we push statuses back (accepted, ready, picked up). Until then, key their orders in here with the commission so the kitchen and reports stay complete.",
            )}
          </p>
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {AGGREGATORS.map((a) => (
          <Card key={a.id} className="grid content-start gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl text-[15px] font-bold text-white" style={{ background: a.color }} aria-hidden>
                {a.name.en.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-bold">{loc(a.name)}</p>
                <p className="text-[12.5px] text-muted">{a.countries.map((c) => (c === "EG" ? L("مصر", "Egypt") : L("السعودية", "Saudi Arabia"))).join(" · ")}</p>
              </div>
              <Badge tone="neutral">{L("مش متربط", "Not connected")}</Badge>
            </div>
            <p className="text-[13.5px] text-ink-2">{loc(a.how)}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <Workflow className="size-4 text-muted" />
              {a.middleware.map((m) => (
                <span key={m} className="rounded-full bg-surface-3 px-2 py-0.5 font-semibold">
                  {m}
                </span>
              ))}
              <span className="ms-auto text-muted">
                {L("عمولة شائعة", "Typical fee")} <b className="num">{a.commissionBps / 100}%</b>
              </span>
            </div>
          </Card>
        ))}
      </div>
      <Card className="flex items-start gap-3 p-4 text-[13.5px] text-ink-2">
        <Cable className="mt-0.5 size-5 shrink-0 text-muted" />
        <p>
          {L(
            "للمطورين: أي ربط بينفّذ AggregatorAdapter (src/modules/delivery/aggregators.ts) على السيرفر — التحقق من توقيع الـ webhook، تحويل الطلب لـ NormalizedOrder، وإرجاع الحالة. مفاتيح الشركاء بتفضل على السيرفر ومش بتوصل للمتصفح أبدًا.",
            "For developers: an integration implements AggregatorAdapter (src/modules/delivery/aggregators.ts) server-side — verify the webhook signature, map to a NormalizedOrder, push statuses back. Partner keys stay on the server, never in the browser.",
          )}
        </p>
      </Card>
      <AggregatorOrderDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

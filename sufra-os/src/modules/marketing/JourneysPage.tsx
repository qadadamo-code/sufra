import { useState } from "react";
import { Cake, HeartHandshake, MessageSquareHeart, Play, Repeat, Share2, Sparkles, UserPlus } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { Journey, JourneyTrigger } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { Badge, Button, Card, Dialog, Select, Switch, useToast } from "@/ui";
import { runJourneys } from "./ops";
import { LocalizedInput, NumberInput } from "./ui";

const META: Record<JourneyTrigger, { icon: React.ReactNode; delay: { ar: string; en: string } }> = {
  welcome: { icon: <UserPlus />, delay: { ar: "يوم بعد التسجيل", en: "days after joining" } },
  birthday: { icon: <Cake />, delay: { ar: "يوم قبل عيد الميلاد", en: "days before the birthday" } },
  winback: { icon: <Repeat />, delay: { ar: "يوم من آخر زيارة", en: "days since the last visit" } },
  post_visit: { icon: <MessageSquareHeart />, delay: { ar: "ساعة بعد الزيارة", en: "hours after the visit" } },
  second_visit: { icon: <HeartHandshake />, delay: { ar: "يوم بعد أول زيارة", en: "days after the first visit" } },
  referral: { icon: <Share2 />, delay: { ar: "", en: "" } },
};

export default function JourneysPage() {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { restaurant, can } = useSession();
  const journeys = useLive("journeys").data;
  const promos = useLive("promotions", { where: { kind: "coupon" } }).data;
  const settings = useLive("settings").data[0] ?? null;
  const [edit, setEdit] = useState<Journey | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[13.5px] text-muted">{L("رسايل بتتبعت لوحدها في الوقت الصح — كل زبون مرة واحدة في الشهر لكل رحلة. في الكلاود بتشتغل كل ساعة من السيرفر.", "Messages that go out by themselves at the right time — once per guest per journey per month. In the cloud a server job runs them hourly.")}</p>
        {can("marketing.manage") ? (
          <Button icon={<Play className="size-4" />} loading={busy} onClick={async () => {
            setBusy(true);
            const n = await runJourneys(db, { restaurantName: restaurant ? loc(restaurant.name) : "", slug: restaurant?.slug ?? "", origin: window.location.origin, lang: "ar", settings });
            setBusy(false);
            toast({ title: n ? L(`اتبعت ${n} رسالة`, `${n} messages sent`) : L("مفيش حد مستحق دلوقتي", "Nobody is due right now"), tone: n ? "success" : "default" });
          }}>
            {L("شغّلها دلوقتي", "Run now")}
          </Button>
        ) : null}
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {journeys.map((j) => (
          <li key={j.id}>
            <Card className="grid h-full gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brass-soft text-brass [&_svg]:size-5">{META[j.trigger].icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{loc(j.name)}</p>
                  <p className="text-[12.5px] text-muted">{j.trigger === "referral" ? L("لما زبون يرشّح صاحبه", "When a guest refers a friend") : `${j.delay} ${META[j.trigger].delay[lang]}`}</p>
                </div>
                <Switch checked={j.enabled} onChange={(v) => can("marketing.manage") && void db.update("journeys", j.id, { enabled: v })} label={<span className="sr-only">{L("شغّال", "On")}</span>} />
              </div>
              <p className="line-clamp-3 rounded-xl bg-surface-2 px-3 py-2 text-[13.5px]">{j.text[lang] || j.text.ar}</p>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <Badge size="sm">{L(`${j.stats.sent} اتبعت`, `${j.stats.sent} sent`)}</Badge>
                {j.stats.redeemed ? <Badge size="sm" tone="ok">{L(`${j.stats.redeemed} رجعوا`, `${j.stats.redeemed} came back`)}</Badge> : null}
                {j.stats.revenue ? <Badge size="sm" tone="brass">{formatMoney(j.stats.revenue, { lang, whole: true })}</Badge> : null}
                {j.promotionId ? <Badge size="sm" tone="primary" icon={<Sparkles className="size-3" />}>{loc(promos.find((p) => p.id === j.promotionId)?.name)}</Badge> : null}
                <span className="flex-1" />
                {j.lastRunAt ? <span className="text-muted">{ago(j.lastRunAt, lang)}</span> : null}
              </div>
              {can("marketing.manage") ? <Button size="sm" variant="secondary" onClick={() => setEdit({ ...j })}>{L("تعديل", "Edit")}</Button> : null}
            </Card>
          </li>
        ))}
      </ul>
      <Dialog open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit ? loc(edit.name) : ""} footer={<Button block size="lg" onClick={async () => {
        if (!edit) return;
        const { id, restaurantId: _r, createdAt: _c, updatedAt: _u, ...rest } = edit;
        await db.update("journeys", id, rest);
        setEdit(null);
      }}>{L("احفظ", "Save")}</Button>}>
        {edit ? (
          <div className="grid gap-4 pb-1">
            <LocalizedInput label={L("الاسم", "Name")} value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
            {edit.trigger !== "referral" ? <NumberInput label={META[edit.trigger].delay[lang]} value={edit.delay} onChange={(n) => setEdit({ ...edit, delay: Math.round(n) })} /> : null}
            <LocalizedInput label={L("الرسالة ({name} {code} {points} {link})", "Message ({name} {code} {points} {link})")} multiline value={edit.text} onChange={(v) => setEdit({ ...edit, text: v })} />
            <Select label={L("عرض (كود شخصي)", "Offer (personal code)")} value={edit.promotionId ?? ""} onChange={(e) => setEdit({ ...edit, promotionId: e.target.value || null })} options={[{ value: "", label: L("من غير عرض", "No offer") }, ...promos.map((p) => ({ value: p.id, label: loc(p.name) }))]} />
            <Select label={L("القناة", "Channel")} value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value as Journey["channel"] })} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "sms", label: "SMS" }]} />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

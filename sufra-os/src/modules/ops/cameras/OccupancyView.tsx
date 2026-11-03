/** Estimated occupancy per zone (BETA): manual head counts + camera counters. */
import { useMemo, useState } from "react";
import { Minus, Plus, Users } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { ago, nowIso, startOfDay } from "@/lib/time";
import { Badge, Button, Card, Meter, useToast } from "@/ui";
import { useNow } from "@/lib/service-calls";
import { BetaBadge } from "../ui";
import { estimateOccupancy } from "./occupancy";
import { useOpsSettings } from "../settings";

export default function OccupancyView() {
  const { L, loc, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { branchId } = useSession();
  const now = useNow(30_000);
  const { cfg } = useOpsSettings();
  const zones = useLive("zones", { where: branchId ? { branchId } : {}, orderBy: [{ field: "sort" }] }).data;
  const since = useMemo(() => startOfDay().toISOString(), []);
  const samples = useLive("peopleCounts", { gte: { at: since }, orderBy: [{ field: "at", dir: "desc" }] }).data;
  const tables = useLive("tables").data;
  const checks = useLive("checks", { where: { status: ["open", "bill_requested"] } }).data;
  const [draft, setDraft] = useState<Record<string, number>>({});

  const save = async (zoneId: string, n: number) => {
    await db.insert("peopleCounts", { branchId: branchId ?? zones[0]?.branchId ?? "", zoneId, cameraId: null, source: "manual", inCount: 0, outCount: 0, occupancy: Math.max(0, Math.round(n)), at: nowIso(), actorId: db.actorId });
    setDraft((d) => ({ ...d, [zoneId]: NaN }));
    toast({ title: L("اتسجل العدد", "Count saved"), tone: "success", duration: 1300 });
  };

  return (
    <div className="grid gap-3">
      <Card className="flex flex-wrap items-center gap-2 border-brass/40 bg-brass-soft/40 p-3 text-[13.5px]">
        <BetaBadge>{L("تجريبي", "Beta")}</BetaBadge>
        <span className="flex-1">{L("الأرقام تقديرية: آخر عدّ يدوي + الداخل والخارج من كاميرات العدّاد. مش بديل عن حالة الطاولات.", "Estimates: the last manual count plus in/out from counter cameras. Not a replacement for table status.")}</span>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {zones.map((z) => {
          const cap = cfg.zoneCapacity[z.id] ?? null;
          const est = estimateOccupancy(samples, z.id, cap || null, now, since);
          const zoneTables = new Set(tables.filter((t) => t.zoneId === z.id).map((t) => t.id));
          const seated = checks.filter((c) => c.tableIds.some((t) => zoneTables.has(t))).reduce((a, c) => a + c.guests, 0);
          const d = draft[z.id];
          const val = Number.isFinite(d) ? d : est.people;
          return (
            <Card key={z.id} data-zone={z.id} className="grid gap-3 p-4">
              <div className="flex items-center gap-2">
                <Users className="size-5 text-primary" />
                <p className="flex-1 text-[16px] font-bold">{loc(z.name)}</p>
                <Badge tone={est.confidence === "high" ? "ok" : est.confidence === "medium" ? "warn" : "neutral"} size="sm">
                  {L("ثقة", "confidence")}: {est.confidence === "high" ? L("عالية", "high") : est.confidence === "medium" ? L("متوسطة", "medium") : L("قليلة", "low")}
                </Badge>
              </div>
              <div className="flex items-end gap-3">
                <p className="num text-[40px] font-bold leading-none">~{est.people}</p>
                <p className="pb-1 text-[13px] text-muted">{cap ? L(`من ${cap} · ${est.pct}٪`, `of ${cap} · ${est.pct}%`) : L("السعة مش محددة", "capacity not set")}</p>
              </div>
              {cap ? <Meter label={L("الإشغال", "Occupancy")} value={Math.min(100, est.pct ?? 0)} max={100} tone={(est.pct ?? 0) > 90 ? "danger" : (est.pct ?? 0) > 70 ? "warn" : "ok"} /> : null}
              <p className="text-[12.5px] text-muted">
                {est.lastAt ? L(`آخر قراءة ${ago(est.lastAt, lang)} · ${est.basis === "manual" ? "يدوي" : est.basis === "counter" ? "عدّاد" : "يدوي + عدّاد"}`, `Last reading ${ago(est.lastAt, lang)} · ${est.basis}`) : L("لسه مفيش قراءات النهارده", "No readings today")}
                {" · "}
                {L(`قاعدين على شيكات مفتوحة: ${seated}`, `Seated on open checks: ${seated}`)}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" aria-label="-" icon={<Minus className="size-4" />} onClick={() => setDraft((x) => ({ ...x, [z.id]: Math.max(0, val - 1) }))} />
                <input aria-label={L("العدد", "Count")} inputMode="numeric" className="num h-11 w-20 rounded-xl border border-line bg-surface text-center text-[16px] font-bold" value={val} onChange={(e) => setDraft((x) => ({ ...x, [z.id]: Number(e.target.value.replace(/\D/g, "")) || 0 }))} />
                <Button size="sm" variant="secondary" aria-label="+" icon={<Plus className="size-4" />} onClick={() => setDraft((x) => ({ ...x, [z.id]: val + 1 }))} />
                <Button size="sm" className="ms-auto" onClick={() => void save(z.id, val)}>{L("سجّل العدد", "Save count")}</Button>
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="p-4 text-[13px] text-muted">
        <p className="mb-1 font-bold text-ink">{L("كاميرات العدّاد", "Counter cameras")}</p>
        {L(
          "كتير من كاميرات Hikvision وDahua بتعدّ الداخل والخارج. سُفرة بيستقبل العدد ده (people_counts) من جهاز صغير في المطعم أو من الـ NVR — شوف DESIGN.md. اكتشاف الطاولات المشغولة بالذكاء الاصطناعي لسه فكرة تحت التجربة ومش بيغيّر حالة الطاولات.",
          "Many Hikvision and Dahua cameras count people in/out. Sufra ingests those counts (people_counts) from a small on-site poller or the NVR — see DESIGN.md. AI table-occupancy detection is a design note only and never changes table status.",
        )}
      </Card>
    </div>
  );
}

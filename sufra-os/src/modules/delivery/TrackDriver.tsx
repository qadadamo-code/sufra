/** Guest tracking page add-on: the rider on a map + live ETA + the door code, while the order is on its way. */
import { useMemo } from "react";
import { KeyRound, Timer } from "lucide-react";
import { useT } from "@/i18n/i18n";
import type { GuestService } from "@/modules/guest/api/service";
import { useLiveFetch } from "@/modules/guest/ui/useLiveFetch";
import { DeliveryMap, type MapPin } from "./map/DeliveryMap";

export default function TrackDriver({ svc, slug, orderId, restaurantId }: { svc: GuestService; slug: string; orderId: string; restaurantId: string }) {
  const { L, lang } = useT();
  const { data: v } = useLiveFetch(svc, restaurantId, () => svc.driverView(slug, orderId), [svc, slug, orderId], 8000);
  const pins = useMemo(() => {
    if (!v) return [];
    const out: MapPin[] = [{ id: "kitchen", kind: "kitchen", lat: v.origin.lat, lng: v.origin.lng }];
    if (v.door) out.push({ id: "door", kind: "door", lat: v.door.lat, lng: v.door.lng, tone: "brass", label: L("إنت", "You") });
    if (v.position) out.push({ id: "rider", kind: "rider", lat: v.position.lat, lng: v.position.lng, heading: v.position.heading, label: v.driver?.name ?? "", tone: "primary" });
    return out;
  }, [v, L]);
  if (!v || (v.stage !== "picked_up" && v.stage !== "arrived")) return null;
  const lines = v.position && v.door ? [{ id: "route", points: [v.position, v.door] }] : [];
  const at = v.etaMin !== null ? new Date(Date.now() + v.etaMin * 60_000).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <section className="overflow-hidden rounded-[24px] border border-line bg-surface shadow-sf-sm">
      <DeliveryMap className="h-[260px]" ariaLabel={L("مكان الطيار", "Rider location")} pins={pins} lines={lines} fitKey={v.position ? `${v.position.lat.toFixed(4)},${v.position.lng.toFixed(4)}` : "none"} touchDrag />
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="grid size-11 place-items-center rounded-full bg-primary-soft text-primary">
          <Timer className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-bold">
            {v.stage === "arrived" ? L("الطيار عند الباب", "Your rider is at the door") : v.etaMin !== null ? L(`هيوصل خلال ~${v.etaMin} دقيقة`, `Arriving in ~${v.etaMin} min`) : L("في الطريق ليك", "On the way")}
          </p>
          <p className="text-[12.5px] text-muted">{v.position ? (at && v.stage !== "arrived" ? L(`حوالي ${at}`, `around ${at}`) : "") : L("موقع الطيار هيظهر أول ما يتحدّث", "The rider's position shows as soon as it updates")}</p>
        </div>
        {v.otp ? (
          <div className="flex items-center gap-2 rounded-2xl bg-brass-soft px-3 py-2 text-brass-text">
            <KeyRound className="size-4.5" />
            <div>
              <p className="text-[11px] font-semibold">{L("كود الاستلام", "Delivery code")}</p>
              <p className="num text-[20px] font-bold leading-none tracking-[0.25em]" dir="ltr">
                {v.otp}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

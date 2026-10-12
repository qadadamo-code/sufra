import { useEffect, useRef, useState } from "react";
import { LocateFixed, Loader2, MapPin, Radio, X } from "lucide-react";
import { areaName } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { forgetLocation, inCairo, locate, startLive, stopLive, useLocation, type LocStatus } from "@/lib/location";
import { notify } from "@/lib/notify";
import { useHome } from "@/lib/store";
import { cn } from "@/lib/utils";

export function useLocStatusText() {
  const { L } = useLang();
  return (s: LocStatus): { title: string; detail: string } | null => {
    switch (s) {
      case "denied":
        return { title: L("إذن الموقع مرفوض", "Location permission denied"), detail: L("فعّله من إعدادات المتصفح (علامة القفل جنب العنوان) وجرّب تاني. لحد كده بنحسب المسافات من المنطقة اللي اخترتها.", "Allow it in your browser settings (the lock icon by the address) and try again. Until then distances use your chosen area.") };
      case "timeout":
        return { title: L("الموقع اتأخر", "Location timed out"), detail: L("جرّب تاني، ويفضّل تشغّل الـGPS أو تقف في مكان مفتوح.", "Try again — turning on GPS or stepping outside helps.") };
      case "unavailable":
        return { title: L("مش قادرين نحدد مكانك", "Couldn't find your location"), detail: L("الجهاز ما رجّعش موقع. هنفضل نحسب من المنطقة اللي اخترتها.", "Your device didn't return a position. We'll keep using your chosen area.") };
      case "unsupported":
        return { title: L("المتصفح مش بيدعم الموقع", "Location isn't supported"), detail: L("اختار منطقتك من القائمة بدلها.", "Pick your area from the list instead.") };
      case "insecure":
        return { title: L("محتاج اتصال آمن", "Needs a secure connection"), detail: L("تحديد الموقع بيشتغل على https بس.", "Location only works over https.") };
      default:
        return null;
    }
  };
}

/** Ask once, toast the outcome (Arabic + English), keep the page usable whatever happens. */
export function useLocate() {
  const { L } = useLang();
  const text = useLocStatusText();
  return async () => {
    const s = await locate();
    const t = text(s);
    if (t) notify({ title: t.title, detail: t.detail, tone: s === "denied" ? "danger" : "brass", icon: "bell", ttl: 7000 });
    else if (s === "ok") {
      const f = (await import("@/lib/location")).getLocation().fix;
      if (f && !inCairo(f)) notify({ title: L("إنت شكلك برا القاهرة", "You seem to be outside Cairo"), detail: L("المسافات هتبان كبيرة — سُفرة دلوقتي في القاهرة الكبرى بس.", "Distances will look large — Sufra covers Greater Cairo for now."), tone: "brass", icon: "bell" });
      else notify({ title: L("تمام، بنحسب من مكانك", "Got it — measuring from where you are"), detail: f?.accuracy ? L(`دقة حوالي ${f.accuracy} م`, `Accurate to about ${f.accuracy} m`) : undefined, ttl: 3000 });
    }
    return s;
  };
}

/** One line: "📍 near <label> · ±25 m" or the area name. */
export function OriginLabel({ className }: { className?: string }) {
  const { L, lang } = useLang();
  const o = useHome();
  if (o.source !== "gps") return <span className={className}>{areaName(o.areaId, lang)}</span>;
  return (
    <span className={className}>
      {o.label ?? L(`قرب ${areaName(o.areaId, "ar")}`, `near ${areaName(o.areaId, "en")}`)}
      {o.accuracy ? <span className="num ms-1 text-xs font-normal text-muted-foreground">±{o.accuracy > 999 ? `${(o.accuracy / 1000).toFixed(1)}k` : o.accuracy}{L("م", "m")}</span> : null}
    </span>
  );
}

/**
 * "استخدم موقعي" — inline pill (hero / explore) or a compact icon with a small panel (header).
 * Live mode keeps updating while the tab is open.
 */
export function LocateButton({ variant = "pill", className }: { variant?: "pill" | "icon"; className?: string }) {
  const { L } = useLang();
  const loc = useLocation();
  const run = useLocate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const busy = loc.status === "locating";
  const on = loc.active && !!loc.fix;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const liveToggle = (
    <button
      type="button"
      role="switch"
      aria-checked={loc.live}
      onClick={() => {
        if (loc.live) stopLive();
        else {
          startLive();
          notify({ title: L("الموقع المباشر شغّال", "Live location on"), detail: L("بنحدّث المسافات وإنت بتتحرك طول ما الصفحة مفتوحة.", "Distances update as you move while this tab is open."), ttl: 3500 });
        }
      }}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium", loc.live ? "border-ok bg-ok-soft text-ok" : "bg-card text-muted-foreground hover:text-foreground")}
    >
      <Radio className={cn("size-3.5", loc.live && "animate-pulse")} aria-hidden />
      {L("مباشر", "Live")}
    </button>
  );

  if (variant === "icon") {
    return (
      <div ref={box} className={cn("relative", className)}>
        <button
          type="button"
          onClick={() => (on ? setOpen((v) => !v) : void run())}
          aria-expanded={on ? open : undefined}
          aria-label={on ? L("موقعي — الإعدادات", "My location — options") : L("استخدم موقعي", "Use my location")}
          title={on ? L("بنحسب من موقعك", "Measuring from your location") : L("استخدم موقعي", "Use my location")}
          className={cn("relative grid size-10 place-items-center rounded-full border bg-card/70 backdrop-blur hover:bg-card", on && "border-primary text-primary")}
        >
          {busy ? <Loader2 className="size-[18px] animate-spin" aria-hidden /> : <LocateFixed className="size-[18px]" aria-hidden />}
          {loc.live ? <span className="absolute end-1 top-1 size-2 rounded-full bg-ok ring-2 ring-background" aria-hidden /> : null}
        </button>
        {open && on ? (
          <div role="dialog" aria-label={L("موقعي", "My location")} className="absolute end-0 top-12 z-50 w-72 rounded-2xl border bg-card p-4 shadow-sf">
            <p className="text-xs font-semibold text-muted-foreground">{L("المسافات محسوبة من", "Distances are measured from")}</p>
            <p className="mt-0.5 font-semibold">
              <MapPin className="me-1 inline size-4 text-brass" aria-hidden />
              <OriginLabel />
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {liveToggle}
              <button type="button" onClick={() => void run()} className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] font-medium hover:bg-surface-2">
                <LocateFixed className="size-3.5" aria-hidden />
                {L("حدّث", "Refresh")}
              </button>
              <button type="button" onClick={() => { forgetLocation(); setOpen(false); }} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-danger hover:bg-danger-soft">
                <X className="size-3.5" aria-hidden />
                {L("وقّف", "Stop")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (on) {
    return (
      <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
        <span className="inline-flex items-center gap-1 font-semibold text-foreground">
          <LocateFixed className="size-4 text-primary" aria-hidden />
          <OriginLabel />
        </span>
        {liveToggle}
        <button type="button" onClick={forgetLocation} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground" aria-label={L("ارجع للمنطقة", "Back to my area")} title={L("ارجع للمنطقة", "Back to my area")}>
          <X className="size-4" aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => void run()} disabled={busy} aria-busy={busy} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-card px-3.5 text-[13px] font-semibold text-primary hover:bg-primary-soft disabled:opacity-70", className)}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LocateFixed className="size-4" aria-hidden />}
      {busy ? L("بنحدد مكانك…", "Locating…") : L("استخدم موقعي", "Use my location")}
    </button>
  );
}

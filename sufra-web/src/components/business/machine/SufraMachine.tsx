/**
 * React shell for the 3D machine: overlay (modes, play/pause, journey bar, labels, tooltip) + a CSS poster that
 * shows while three.js loads and stays as the fallback when WebGL is unavailable. three.js is pulled in with a
 * dynamic import so it only ships in this chunk.
 */
import { useEffect, useRef, useState } from "react";
import { Boxes, ChefHat, Layers, Pause, Play, QrCode, Receipt, ScanLine, Scissors, Truck, Wallet } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { MachineHandle, MachineMode, StationId } from "./scene";
import "./machine.css";

const ORDER: StationId[] = ["guest", "kitchen", "cashier", "delivery", "payment"];

export function useStationCopy() {
  const { L } = useLang();
  return {
    guest: { name: L("طلب الضيف", "Guest order"), desc: L("QR على الترابيزة أو تطبيق سُفرة — الطلب يوصل في ثانية", "Table QR or the Sufra app — the order lands in a second") },
    kitchen: { name: L("المطبخ", "Kitchen"), desc: L("تذكرة على شاشة المطبخ لكل محطة، بتوقيت", "A timed ticket on each station's kitchen screen") },
    cashier: { name: L("الكاشير", "Cashier"), desc: L("الفاتورة مفتوحة، تقسيم ودمج وخصومات", "Open bills, split, merge and discounts") },
    delivery: { name: L("التوصيل", "Delivery"), desc: L("الطيار والتتبع المباشر للضيف", "Rider dispatch and live tracking for the guest") },
    payment: { name: L("الدفع والإيصال الإلكتروني", "Payment & e-receipt"), desc: L("ضريبة 14% + خدمة 12%، إيصال ETA بـ QR", "VAT 14% + service 12%, ETA e-receipt with QR") },
  } satisfies Record<StationId, { name: string; desc: string }>;
}

function Poster({ className, failed }: { className?: string; failed?: boolean }) {
  const { L } = useLang();
  const copy = useStationCopy();
  const icons = { guest: QrCode, kitchen: ChefHat, cashier: Wallet, delivery: Truck, payment: Receipt };
  return (
    <div className={cn("mc-poster", className)} aria-hidden={!failed}>
      <div className="mc-plate">
        {ORDER.map((id, i) => {
          const Icon = icons[id];
          return (
            <div key={id} className="mc-station" style={{ ["--i" as string]: i }}>
              <span className="mc-station-icon">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="num text-[11px] text-brass">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[13px] font-semibold leading-tight">{copy[id].name}</span>
            </div>
          );
        })}
        <div className="mc-belt" />
      </div>
      {failed ? <p className="mt-3 text-center text-[12px] text-muted-foreground">{L("المجسّم ثلاثي الأبعاد مش متاح على الجهاز ده — دي نسخة ثابتة.", "3D isn't available on this device — showing a still version.")}</p> : null}
    </div>
  );
}

export default function SufraMachine({ className, embed = true }: { className?: string; embed?: boolean }) {
  const { L, dir } = useLang();
  const copy = useStationCopy();
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const api = useRef<MachineHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mode, setModeState] = useState<MachineMode>("assembled");
  const [playing, setPlaying] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [journey, setJourney] = useState({ step: 0, progress: 0 });
  const [focused, setFocused] = useState<StationId | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = host.current;
    if (!el || !labels.current || !tooltip.current) return;
    (async () => {
      try {
        const mod = await import("./scene");
        if (cancelled) return;
        if (!mod.webglAvailable()) {
          setFailed(true);
          return;
        }
        // canvas textures are painted with the web fonts — wait for them
        try {
          await Promise.race([Promise.all([document.fonts.load('600 32px "IBM Plex Sans Arabic"'), document.fonts.load('500 20px "IBM Plex Mono"')]), new Promise((r) => setTimeout(r, 2500))]);
        } catch {
          /* fonts unavailable: canvases fall back to system fonts */
        }
        if (cancelled) return;
        api.current = mod.initMachine(el, {
          embed,
          side: dir === "rtl" ? "left" : "right",
          stations: copy,
          labels: labels.current!,
          tooltip: tooltip.current!,
          onReady: () => setReady(true),
          onStation: (id) => setFocused(id),
          onJourney: (step, progress) => setJourney({ step, progress }),
          onPlaying: setPlaying,
          onError: () => setFailed(true),
        });
      } catch (e) {
        console.warn("Sufra machine: falling back to the still poster", e);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      api.current?.dispose();
      api.current = null;
      setReady(false);
    };
    // re-create when direction changes (machine side + label copy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, embed]);

  const setMode = (m: MachineMode) => {
    setModeState(m);
    setFocused(null);
    api.current?.setMode(m);
  };
  const modes: { id: MachineMode; label: string; Icon: typeof Boxes }[] = [
    { id: "assembled", label: L("مُجمّعة", "Assembled"), Icon: Boxes },
    { id: "cutaway", label: L("من جوّه", "Cutaway"), Icon: Scissors },
    { id: "stations", label: L("المحطات", "Stations"), Icon: Layers },
    { id: "order", label: L("رحلة طلب", "One order"), Icon: ScanLine },
  ];
  const step = ORDER[journey.step] ?? "guest";

  return (
    <div className={cn("mc-root", embed && "mc-embed", dir === "rtl" ? "mc-left" : "mc-right", className)}>
      <div ref={host} className={cn("mc-canvas", ready && !failed && "is-ready")} role="img" aria-label={L("مجسّم تفاعلي لسستم سُفرة: طلب الضيف، المطبخ، الكاشير، التوصيل، والدفع والإيصال الإلكتروني. اسحب للتدوير واضغط على أي محطة.", "Interactive 3D machine of the Sufra system: guest order, kitchen, cashier, delivery, payment & e-receipt. Drag to rotate, click a station.")} />
      {!ready || failed ? <Poster className={cn(failed ? "is-failed" : "is-loading")} failed={failed} /> : null}
      <div ref={labels} className="mc-labels" aria-hidden />
      <div ref={tooltip} className="mc-tooltip" role="tooltip">
        <strong />
        <p />
      </div>
      {!failed ? (
        <div className="mc-controls">
          <div role="radiogroup" aria-label={L("وضع العرض", "View mode")} className="mc-bar">
            {modes.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}>
                <m.Icon className="size-3.5" aria-hidden />
                <span>{m.label}</span>
              </button>
            ))}
            <span className="mc-divider" aria-hidden />
            <button type="button" aria-pressed={!playing} aria-label={playing ? L("إيقاف الحركة", "Pause animation") : L("تشغيل الحركة", "Play animation")} onClick={() => (playing ? api.current?.pause() : api.current?.play())}>
              {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
            </button>
          </div>
          {focused ? (
            <div className="mc-focus" aria-live="polite">
              <span className="num text-brass">{String(ORDER.indexOf(focused) + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <strong className="block truncate">{copy[focused].name}</strong>
                <span className="block text-[12px] opacity-75">{copy[focused].desc}</span>
              </span>
              <button type="button" onClick={() => { setFocused(null); api.current?.overview(); }} className="mc-mini">
                {L("الكل", "All")}
              </button>
            </div>
          ) : null}
          {mode === "order" ? (
            <div className="mc-journey" aria-live="polite">
              <span className="num text-brass">{String(journey.step + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate">{copy[step].name}</strong>
                <span className="block truncate text-[12px] opacity-75">{copy[step].desc}</span>
              </span>
              <span className="mc-track">
                <i style={{ width: `${Math.round(journey.progress * 100)}%` }} />
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Hold-to-talk button: pointer (touch/mouse) + Space while focused. Drives the shared radio engine. */
import { useEffect, useRef } from "react";
import { Mic, MicOff, Loader2, Radio } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { useToast } from "@/ui";
import type { RadioChannelId } from "../types";
import { radio, useRadioEngine } from "./engine";
import { progress } from "./ptt";

export function usePttNotices() {
  const snap = useRadioEngine();
  const { L } = useT();
  const { toast } = useToast();
  const last = useRef(0);
  useEffect(() => {
    const n = snap.notice;
    if (!n || n.at === last.current) return;
    last.current = n.at;
    if (n.kind === "too_short") toast({ title: L("قصير أوي — اضغط مطوّل واتكلم", "Too short — hold and talk"), tone: "warn", duration: 1800 });
    if (n.kind === "mic_denied") toast({ title: L("المايك مقفول", "Microphone blocked"), description: L("اسمح للمتصفح يستخدم المايك من إعدادات الموقع.", "Allow microphone access in the site settings."), tone: "error" });
    if (n.kind === "unsupported") toast({ title: L("الجهاز ده مش بيدعم التسجيل", "Recording isn't supported on this device"), tone: "error" });
    if (n.kind === "upload_failed") toast({ title: L("ما اتبعتش — جرّب تاني", "Not sent — try again"), tone: "error" });
    if (n.kind === "auto_cut") toast({ title: L("اتبعت (وصلت للحد الأقصى)", "Sent (max length reached)"), tone: "default", duration: 1800 });
  }, [snap.notice, L, toast]);
}

export function PttButton({ channel, size = "lg", label, className }: { channel: RadioChannelId; size?: "md" | "lg" | "fab"; label?: string; className?: string }) {
  const snap = useRadioEngine();
  const { L } = useT();
  const phase = snap.ptt.phase;
  const live = (phase === "arming" || phase === "recording") && snap.talkingOn === channel;
  const busy = snap.onAir.find((a) => a.channel === channel && a.who !== snap.me);
  const pct = live ? progress(snap.ptt, snap.config) : 0;
  const secs = snap.ptt.phase === "recording" ? Math.floor(snap.ptt.elapsedMs / 1000) : 0;
  const keyDown = useRef(false);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    void radio.press(channel);
  };
  const up = (e: React.PointerEvent) => {
    e.preventDefault();
    radio.release();
  };

  const dim = size === "fab" ? "size-16" : size === "md" ? "size-24" : "size-40 sm:size-44";
  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <button
      type="button"
      aria-label={label ?? L("اضغط مطوّل واتكلم", "Hold to talk")}
      aria-pressed={live}
      data-ptt={channel}
      data-phase={live ? phase : "idle"}
      className={cn(
        "relative grid shrink-0 touch-none select-none place-items-center rounded-full outline-none transition-[transform,background-color,box-shadow] duration-150 [-webkit-touch-callout:none] focus-visible:ring-4 focus-visible:ring-primary/30",
        dim,
        live ? "scale-105 bg-danger text-white shadow-[0_0_0_10px_color-mix(in_srgb,var(--sf-danger)_18%,transparent)]" : phase === "sending" && snap.talkingOn === channel ? "bg-primary/80 text-primary-ink" : "bg-primary text-primary-ink shadow-sf hover:brightness-105",
        className,
      )}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => radio.cancel()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !keyDown.current) {
          e.preventDefault();
          keyDown.current = true;
          void radio.press(channel);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          keyDown.current = false;
          radio.release();
        }
      }}
      onBlur={() => keyDown.current && (radio.release(), (keyDown.current = false))}
    >
      {size !== "fab" ? (
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth="3" />
          <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
        </svg>
      ) : null}
      <span className="pointer-events-none flex flex-col items-center gap-1">
        {phase === "arming" && live ? <Loader2 className={cn("animate-spin", size === "fab" ? "size-7" : "size-10")} /> : phase === "error" && snap.talkingOn === null ? <MicOff className={size === "fab" ? "size-7" : "size-11"} /> : live ? <Radio className={size === "fab" ? "size-7" : "size-11"} /> : <Mic className={size === "fab" ? "size-7" : "size-11"} />}
        {size !== "fab" ? (
          <span className="text-[13px] font-bold leading-tight">
            {live ? <span className="num">{L("على الهوا", "On air")} · {secs}s</span> : busy ? L(`${busy.name} بيتكلم`, `${busy.name} talking`) : L("اضغط واتكلم", "Hold to talk")}
          </span>
        ) : null}
        {live && size !== "fab" ? (
          <span className="flex h-3 items-end gap-0.5" aria-hidden>
            {[0.3, 0.6, 1, 0.6, 0.3].map((f, i) => (
              <span key={i} className="w-1 rounded-full bg-current" style={{ height: `${Math.max(2, snap.level * f * 12)}px` }} />
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

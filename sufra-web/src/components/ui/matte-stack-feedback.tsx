// MatteStackFeedback — notification stack rebuilt from the owner's spec (max 3 visible, the rest queued, max 20).
import * as React from "react";
import { BellRing, Check, X } from "lucide-react";
import "./matte-feedback.css";

export type FeedbackItem = { id: string; title: string; detail?: string; tone?: "primary" | "brass" | "danger"; icon?: "check" | "bell" };

export const MAX_VISIBLE = 3;
export const MAX_QUEUE = 20;

export function MatteStackFeedback({
  items,
  onDismiss,
  closeLabel = "Dismiss",
  counter = (v: number, q: number) => `${v} visible · ${q} queued`,
  regionLabel = "Notifications",
}: {
  items: FeedbackItem[];
  onDismiss: (id: string) => void;
  closeLabel?: string;
  counter?: (visible: number, queued: number) => string;
  regionLabel?: string;
}) {
  const [leaving, setLeaving] = React.useState<Set<string>>(new Set());
  const capped = items.slice(0, MAX_VISIBLE + MAX_QUEUE);
  const visible = capped.slice(0, MAX_VISIBLE);
  const queued = capped.length - visible.length;
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const dismiss = (id: string) => {
    if (reduce) return onDismiss(id);
    setLeaving((s) => new Set(s).add(id));
    window.setTimeout(() => {
      onDismiss(id);
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, 320);
  };
  return (
    <section className="fb-stack" aria-label={regionLabel}>
      <div aria-live="polite" aria-relevant="additions" style={{ display: "contents" }}>
        {visible.map((it) => (
          <div key={it.id} className="fb-item" data-state={leaving.has(it.id) ? "leaving" : "shown"}>
            <div className="fb-clip">
              <div className="fb-card" data-tone={it.tone ?? "primary"} role="status">
                <span className="fb-icon" aria-hidden>
                  {it.icon === "bell" ? <BellRing size={15} /> : <Check size={15} />}
                </span>
                <div className="fb-body">
                  <div className="fb-title">{it.title}</div>
                  {it.detail ? <div className="fb-detail">{it.detail}</div> : null}
                </div>
                <button type="button" className="fb-close" aria-label={closeLabel} onClick={() => dismiss(it.id)}>
                  <X size={15} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {queued > 0 ? <span className="fb-counter">{counter(visible.length, queued)}</span> : null}
    </section>
  );
}

/** MatteAlertFeedback — card with heading + pill + text and a collapsible inline alert. */
export function MatteAlertFeedback({
  heading,
  pill,
  text,
  alertTitle,
  alertDetail,
  showLabel = "Show alert",
  closeLabel = "Dismiss alert",
}: {
  heading: string;
  pill?: string;
  text?: React.ReactNode;
  alertTitle: string;
  alertDetail?: string;
  showLabel?: string;
  closeLabel?: string;
}) {
  const [open, setOpen] = React.useState(true);
  const [said, setSaid] = React.useState("");
  const showRef = React.useRef<HTMLButtonElement>(null);
  return (
    <div className="fb-alert-card">
      <div className="fb-alert-head">
        <h3>{heading}</h3>
        {pill ? <span className="fb-pill">{pill}</span> : null}
      </div>
      {text ? <div style={{ marginTop: 6, color: "var(--muted-foreground)", fontSize: 14 }}>{text}</div> : null}
      <div className="fb-alert-wrap" data-open={open}>
        <div>
          <div className="fb-alert" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 3 2 21h20L12 3z" strokeLinejoin="round" />
              <path d="M12 10v5M12 18v.01" strokeLinecap="round" />
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{alertTitle}</div>
              {alertDetail ? <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{alertDetail}</div> : null}
            </div>
            <button
              type="button"
              className="fb-close"
              aria-label={closeLabel}
              tabIndex={open ? 0 : -1}
              onClick={() => {
                setOpen(false);
                setSaid(alertTitle + " ✕");
                window.setTimeout(() => showRef.current?.focus(), 320);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {!open ? (
        <button ref={showRef} type="button" className="fb-show" onClick={() => setOpen(true)}>
          {showLabel}
        </button>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </div>
  );
}

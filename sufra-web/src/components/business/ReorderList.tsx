/**
 * ReorderList — rebuilt from the owner's spec (small-controls.tsx): motion's Reorder.Group axis="y" with a 6-dot grip,
 * lifted rows scale 1.02 with a bigger shadow; keyboard: Space/Enter grabs, ArrowUp/Down moves, Space/Enter drops,
 * Escape restores the snapshot taken on grab; a role=status live region announces grab/drop.
 */
import { useRef, useState, type ReactNode } from "react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface ReorderListProps<T> {
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  onReorder: (items: T[]) => void;
  onCommit?: (items: T[]) => void;
  disabled?: boolean;
  label: string;
  children: (item: T) => ReactNode;
  messages?: {
    grabbed: (label: string, pos: number, total: number) => string;
    moved: (label: string, pos: number, total: number) => string;
    dropped: (label: string, pos: number) => string;
    cancelled: (label: string) => string;
    hint: string;
  };
}

const EN = {
  grabbed: (l: string, p: number, t: number) => `${l} grabbed, position ${p} of ${t}.`,
  moved: (l: string, p: number, t: number) => `${l}, position ${p} of ${t}.`,
  dropped: (l: string, p: number) => `${l} dropped at position ${p}.`,
  cancelled: (l: string) => `Reorder cancelled. ${l} returned.`,
  hint: "Press Space to grab, arrow keys to move, Space to drop, Escape to cancel.",
};

function Grip() {
  return (
    <svg viewBox="0 0 10 16" className="h-4 w-2.5" aria-hidden>
      {[2, 8].map((x) => [3, 8, 13].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />))}
    </svg>
  );
}

function Row<T>({ item, id, label, grabbed, disabled, onKey, children, onDragEnd }: { item: T; id: string; label: string; grabbed: boolean; disabled?: boolean; onKey: (e: React.KeyboardEvent) => void; children: ReactNode; onDragEnd: () => void }) {
  const controls = useDragControls();
  const reduced = useReducedMotion();
  return (
    <Reorder.Item
      value={item}
      id={id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      whileDrag={reduced ? undefined : { scale: 1.02, boxShadow: "0 18px 40px -16px rgb(0 0 0 / 0.35)" }}
      className={cn("relative flex items-center gap-3 rounded-[9px] border bg-card px-3 py-2.5 shadow-sm", grabbed && "ring-2 ring-brass")}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-pressed={grabbed}
        onPointerDown={(e) => !disabled && controls.start(e)}
        onKeyDown={onKey}
        className="grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing disabled:cursor-not-allowed"
      >
        <Grip />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </Reorder.Item>
  );
}

export function ReorderList<T>({ items, getId, getLabel, onReorder, onCommit, disabled, label, children, messages = EN }: ReorderListProps<T>) {
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const snapshot = useRef<T[] | null>(null);
  const latest = useRef(items);
  latest.current = items;

  const keyFor = (item: T) => (e: React.KeyboardEvent) => {
    const id = getId(item);
    const lbl = getLabel(item);
    const idx = latest.current.findIndex((x) => getId(x) === id);
    const total = latest.current.length;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (grabbed === id) {
        setGrabbed(null);
        snapshot.current = null;
        setLive(messages.dropped(lbl, idx + 1));
        onCommit?.(latest.current);
      } else {
        snapshot.current = latest.current;
        setGrabbed(id);
        setLive(messages.grabbed(lbl, idx + 1, total));
      }
    } else if (grabbed === id && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const to = idx + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= total) return;
      const next = [...latest.current];
      const [m] = next.splice(idx, 1);
      next.splice(to, 0, m);
      onReorder(next);
      setLive(messages.moved(lbl, to + 1, total));
      requestAnimationFrame(() => (e.target as HTMLElement).focus());
    } else if (grabbed === id && e.key === "Escape") {
      e.preventDefault();
      if (snapshot.current) onReorder(snapshot.current);
      snapshot.current = null;
      setGrabbed(null);
      setLive(messages.cancelled(lbl));
    }
  };

  return (
    <div>
      <p className="sr-only" id="reorder-hint">{messages.hint}</p>
      <Reorder.Group axis="y" values={items} onReorder={onReorder} className="grid gap-2" aria-label={label} aria-describedby="reorder-hint">
        {items.map((item) => (
          <Row key={getId(item)} item={item} id={getId(item)} label={getLabel(item)} grabbed={grabbed === getId(item)} disabled={disabled} onKey={keyFor(item)} onDragEnd={() => onCommit?.(latest.current)}>
            {children(item)}
          </Row>
        ))}
      </Reorder.Group>
      <span role="status" className="sr-only">{live}</span>
    </div>
  );
}

export default ReorderList;

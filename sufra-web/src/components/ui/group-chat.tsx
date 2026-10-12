// GroupChat — rebuilt from the owner's spec (blobatar faces). Uses animated (inline SVG) blobatars so no data: URLs
// are needed under a strict CSP.
import * as React from "react";
import { Blobatar } from "@blobatar/react";
import type { BlobatarOptions } from "blobatar";
import { cn } from "@/lib/utils";

export type ChatMessage = { name: string; title?: string; text: string; time?: string };

export function GroupChat({
  messages,
  channel = "general",
  members = [],
  extra,
  typing,
  typingLabel = (n: string) => `${n} is typing`,
  blobatar,
  className,
  children,
}: {
  messages: ChatMessage[];
  channel?: string;
  members?: string[];
  extra?: number;
  typing?: string;
  typingLabel?: (name: string) => string;
  blobatar?: BlobatarOptions;
  className?: string;
  /** Sufra: composer / extra content under the conversation */
  children?: React.ReactNode;
}) {
  // consecutive messages from the same person collapse into one run (derived, never stored)
  const runs = messages.reduce<{ name: string; title?: string; time?: string; texts: string[] }[]>((acc, m) => {
    const last = acc[acc.length - 1];
    if (last && last.name === m.name) last.texts.push(m.text);
    else acc.push({ name: m.name, title: m.title, time: m.time, texts: [m.text] });
    return acc;
  }, []);
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="num truncate text-sm font-medium" dir="ltr">
          # {channel}
        </span>
        <div className="flex items-center">
          {members.map((m) => (
            <Blobatar key={m} name={m} background="circle" animate="hover" {...blobatar} className="-ms-2 size-7 rounded-full ring-2 ring-card first:ms-0" aria-hidden />
          ))}
          {extra ? (
            <span className="num -ms-2 grid size-7 place-items-center rounded-full bg-muted text-[11px] font-semibold ring-2 ring-card">+{extra}</span>
          ) : null}
        </div>
      </header>
      <div className="grid gap-4 px-4 py-4">
        {runs.map((run) => (
          <div key={`${run.name}-${run.time}-${run.texts.length}`} className="flex gap-3">
            <Blobatar name={run.name} animate="hover" {...blobatar} className="size-10 shrink-0" title={run.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-semibold">{run.name}</span>
                {run.title ? <span className="truncate text-xs text-muted-foreground">{run.title}</span> : null}
                {run.time ? (
                  <span className="num ms-auto shrink-0 text-xs text-muted-foreground" dir="ltr">
                    {run.time}
                  </span>
                ) : null}
              </div>
              {run.texts.map((t, i) => (
                <p key={i} className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">
                  {t}
                </p>
              ))}
            </div>
          </div>
        ))}
        {typing ? (
          <div className="flex items-center gap-3" aria-live="polite">
            <Blobatar name={typing} animate="always" {...blobatar} className="size-8 opacity-50" aria-hidden />
            <span className="text-sm text-muted-foreground">{typingLabel(typing)}…</span>
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default GroupChat;

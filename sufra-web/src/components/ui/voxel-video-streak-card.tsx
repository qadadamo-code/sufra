// VoxelVideoStreakCard — rebuilt from the owner's spec. Account page "نقاط سُفرة".
import * as React from "react";
import { Flame, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTilt, VideoFrame } from "./voxel-video";

export function VoxelVideoStreakCard({
  headingTop,
  headingAccent,
  subtitle,
  streakDays,
  streakLabel,
  daysWord = "Days",
  levelNumber,
  levelLabel,
  levelWord = "Level",
  videoSrc,
  posterSrc,
  videoBadgeText,
  muteLabels,
  className,
  children,
}: {
  headingTop: string;
  headingAccent: string;
  subtitle: string;
  streakDays: number;
  streakLabel: string;
  daysWord?: string;
  levelNumber: number;
  levelLabel: string;
  levelWord?: string;
  videoSrc?: string | null;
  posterSrc?: string | null;
  videoBadgeText: string;
  muteLabels?: { off: string; on: string };
  className?: string;
  children?: React.ReactNode;
}) {
  const tilt = useTilt(8, 6);
  return (
    <section className={cn("relative overflow-hidden rounded-3xl border bg-card p-5 sm:p-8", className)}>
      {/* decorative voxels */}
      {[
        "top-6 end-10 size-3 bg-brass/70",
        "top-16 end-24 size-2 bg-primary/60 [animation-delay:.6s]",
        "bottom-10 start-8 size-2.5 bg-brass/50 [animation-delay:1.2s]",
        "top-1/2 end-4 size-1.5 bg-primary/50 [animation-delay:.3s]",
      ].map((c) => (
        <span key={c} aria-hidden className={cn("absolute animate-pulse rounded-[3px]", c)} />
      ))}
      <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h2 className="text-3xl font-bold leading-tight sm:text-4xl">
            <span className="block">{headingTop}</span>
            <span className="block text-brass">{headingAccent}</span>
          </h2>
          <p className="mt-3 max-w-md text-muted-foreground">{subtitle}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <div className="flex items-center gap-3 rounded-2xl border bg-background px-4 py-3 transition-transform duration-300 hover:-translate-y-1">
              <span className="grid size-10 place-items-center rounded-xl bg-warn-soft text-warn">
                <Flame className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold">
                  <span className="num">{streakDays}</span> {daysWord}
                </span>
                <span className="block text-xs text-muted-foreground">{streakLabel}</span>
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border bg-background px-4 py-3 transition-transform duration-300 hover:-translate-y-1">
              <span className="grid size-10 place-items-center rounded-xl bg-brass-soft text-brass">
                <Trophy className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold">
                  {levelWord} <span className="num">{levelNumber}</span>
                </span>
                <span className="block text-xs text-muted-foreground">{levelLabel}</span>
              </span>
            </div>
          </div>
          {children}
        </div>
        <div ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave} style={tilt.style}>
          <VideoFrame videoSrc={videoSrc} posterSrc={posterSrc} badge={videoBadgeText} muteLabels={muteLabels} className="shadow-xl" />
        </div>
      </div>
    </section>
  );
}

export default VoxelVideoStreakCard;

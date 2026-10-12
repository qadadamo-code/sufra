// VoxelStoryVideoCard — rebuilt from the owner's spec. Restaurant page "من المطبخ".
import * as React from "react";
import { ShieldCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTilt, VideoFrame } from "./voxel-video";

export function VoxelStoryVideoCard({
  badgeText,
  badgeIcon: BadgeIcon,
  title,
  description,
  tags = [],
  videoSrc,
  posterSrc,
  videoBadgeText,
  muteLabels,
  className,
  fallback,
}: {
  badgeText: string;
  badgeIcon?: LucideIcon;
  title: string;
  description: string;
  tags?: string[];
  videoSrc?: string | null;
  posterSrc?: string | null;
  videoBadgeText: string;
  muteLabels?: { off: string; on: string };
  className?: string;
  fallback?: React.ReactNode;
}) {
  const tilt = useTilt(5, 4);
  return (
    <div
      ref={tilt.ref}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      style={tilt.style}
      className={cn("mx-auto w-full max-w-4xl rounded-3xl border bg-gradient-to-b from-card/90 to-card/50 p-4 shadow-xl sm:p-8", className)}
    >
      <div className="grid items-center gap-6 md:grid-cols-2">
        <VideoFrame videoSrc={videoSrc} posterSrc={posterSrc} badge={videoBadgeText} muteLabels={muteLabels} fallback={fallback} />
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-brass">
            {BadgeIcon ? <BadgeIcon className="size-3.5" aria-hidden /> : null}
            {badgeText}
          </span>
          <h3 className="mt-3 text-2xl font-bold sm:text-3xl">{title}</h3>
          <p className="mt-2 text-muted-foreground">{description}</p>
          {tags.length ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {tags.map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default VoxelStoryVideoCard;

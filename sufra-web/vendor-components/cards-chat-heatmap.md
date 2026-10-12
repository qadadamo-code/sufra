# Remaining customer-side components (specs from the owner's paste)

These were pasted in full; the behaviour that matters is recorded here precisely. Rebuild them in
`src/components/ui/` with the same names, props and behaviour, styled with Sufra tokens.

## group-chat.tsx  (deps: blobatar, @blobatar/react)
- `GroupChat({ messages: {name, title?, text, time?}[], channel?, members?: string[], extra?, typing?, blobatar?: BlobatarOptions, className })`
- Card `bg-card border rounded-xl`. Header row: `# channel` in mono on one side; on the other a facepile of
  `<Blobatar name background="circle" className="ring-card -ml-2 size-7 rounded-full ring-2 first:ml-0" alt="" />`
  plus a `+{extra}` disc. (Ring in the card colour separates overlapping discs, so the card must be opaque.)
- Body: consecutive messages from the same `name` collapse into one run (computed with a reduce, not stored);
  each run: `<Blobatar name animate="hover" className="size-10" title>` + name + mono time, then each message text as a
  muted paragraph. Run key = `${name}-${time}-${length}`.
- Typing row: bare Blobatar at 50% opacity + `aria-live="polite"` "{typing} is typing".
- `import "blobatar/motion.css"` once in the app for the hover animation.

## user-table.tsx  (deps: blobatar, @blobatar/react) — dashboard side, not needed for the customer site.
- Table in a scroll wrapper (`overflow-x-auto rounded-xl border bg-card`, table `min-w-[34rem]`), sr-only caption,
  `th scope="col"`: User (Blobatar `name={user.id}` background="squircle" alt="" size-8 + name + muted email),
  Role (muted), Status (rounded-full bordered pill), Last seen (right aligned mono xs). Row hover `bg-accent`.

## voxel-story-video-card.tsx  (deps: lucide-react)
- Props: badgeText, badgeIcon (lucide component), title, description, tags[], videoSrc, posterSrc, videoBadgeText.
- Card: `max-w-4xl rounded-3xl border bg-gradient-to-b from-card/90 to-card/50 p-4 sm:p-8 shadow-xl`, tilts with the mouse:
  `perspective(1000px) rotateX(y) rotateY(x)` where x∈[-5,5], y∈[-4,4] from pointer offset, eased 0.15s, resets on leave.
- Grid md:2 columns: (1) aspect-video rounded-2xl video `autoPlay loop muted playsInline preload="metadata"` with gradient
  overlay, a top-start pill (pulsing emerald dot + videoBadgeText), a bottom-end mute toggle (VolumeX "Audio" / Volume2
  "Playing"); (2) badge pill with icon, big black title, muted description, tags as emerald pills with ShieldCheck.
- If URL has `capture=1` or `snapshot=1`, render the poster image instead of the video.

## voxel-video-streak-card.tsx  (deps: lucide-react)
- Section with a few small decorative pulsing squares; heading in two lines (second line in accent colour), subtitle,
  two stat pills that lift on hover: Flame "{streakDays} Days / streakLabel" and Trophy "Level {levelNumber} / levelLabel";
  then a tilting (±8°/±6°) aspect-video video card with a live pill and mute toggle, same as above.

## activity-heatmap.tsx  (deps: motion) — supporting files were NOT provided; write them.
- `ActivityHeatmap({ days: {date:'YYYY-MM-DD', count}[], label, period, unit={one,other}, thresholds?, weekStartsOn=0|1,
  selectedDate, onSelectDate, actions, locale="en-US", className })`
- Builds a model: UTC days from min..max date, counts, 5 levels (0 and quarters of the busiest day unless thresholds given),
  weeks as columns / weekdays as rows, month labels (drop a cramped first label), per-level day counts.
- Header: "{RollingNumber total} {unit} in {RiseText period}" — RollingNumber rolls each digit up/down with blur, width
  animates on a spring; RiseText crossfades words rising from a soft blur.
- Grid `role="grid"`, cells `role="gridcell"` with aria-label "N contributions, Weekday, Month D, YYYY"; roving tabindex;
  arrows move by day/week, Home/End, Enter selects, Escape closes tooltip.
- First time in view the cells wave in diagonally (per-cell CSS var `--wave` delay, total ≤ 420ms); a later range change
  recolours in a sweep forward or backward.
- One shared tooltip bubble that jumps when opening and glides on a spring between cells; text rolls up/down by count.
- A selection ring glides between cells via CSS; legend "Less [5 swatches] More": hover/focus previews a level (others dim),
  click pins it; caption "N days with 1–3 contributions".
- motion tokens needed: ease.enter cubic-bezier(.16,1,.3,1), ease.standard (.22,1,.36,1), blur.soft 4 / subtle 2,
  spring.snappy {stiffness 500, damping 38}, spring.morph {stiffness 300, damping 32}, duration.fast .16.
- CSS vars given by the owner: --accent oklch(33% 0 0); --surface; --text-secondary; --text-muted; --border-strong;
  --radius-control 1.125rem; --shadow-raised; --ease-enter; --ease-standard; --duration-fast 160ms. Use Sufra's accent instead.

## contribution-skyline.tsx — dashboard side (restaurant: a year of orders). Canvas heat map that folds into an
isometric 3D skyline (camera swings, bars rise in a wave oldest→newest), 2D/3D toggle, stats (total, busiest day,
longest/current streak), legend hover isolates a level, drag to orbit in 3D. Will be done later with the dashboard.

## matte-alert-feedback.tsx / matte-stack-feedback.tsx — notifications
- Alert: card with heading + pill + text and a collapsible inline alert (warning triangle, title, detail, close button);
  dismiss collapses it (grid-rows 1fr→0fr) and focuses the "Show alert" button; live region announces.
- Stack: max 3 visible notification cards (check icon, title, detail, close), the rest queue (max 20); a dismissed card
  collapses then the next queued card animates in; counter "3 visible · 2 queued"; respects reduced motion.
- The `fb-*` CSS was not provided; write it in Sufra's style.

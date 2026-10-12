// LensZoomCarousel — from the owner's paste (21st.dev). Adapted for Sufra: brand fonts, logical (RTL-safe) positioning,
// localised labels, overlay children. Slides are local photos; a slide without an image shows the dark ground.
import * as React from "react"

export type Slide = { image?: string; title?: string; caption?: string; alt?: string }

export function wrap(i: number, n: number): number {
  return n ? ((i % n) + n) % n : 0
}
export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v))
}
export function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n)
}

export function ghostScale(depth: number, g: number): number {
  return depth + (depth - 1) * 0.6 * (g + 1)
}

const LZ_CSS = [
  ".lz-root{position:relative;width:100%;overflow:hidden;background:#0e1412;color:var(--lz-ink);user-select:none;-webkit-user-select:none;touch-action:pan-y;outline:none}",
  ".lz-root:focus-visible{box-shadow:inset 0 0 0 2px var(--lz-ink)}",
  ".lz-base{position:absolute;inset:0;transition:filter .9s ease,transform 1.4s cubic-bezier(.2,.7,.2,1)}",
  ".lz-root[data-moving='1'] .lz-base{filter:brightness(.42);transform:scale(1.04)}",
  ".lz-img{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;display:block;pointer-events:none}",
  ".lz-in{position:absolute;inset:0;overflow:hidden;animation:lz-show var(--lz-d) cubic-bezier(.2,.75,.2,1) both}",
  ".lz-main{animation:lz-zoom var(--lz-d) cubic-bezier(.16,.8,.2,1) both}",
  ".lz-ghost{opacity:0;mix-blend-mode:screen;animation:lz-ghost var(--lz-d) cubic-bezier(.16,.8,.2,1) both}",
  ".lz-shade{position:absolute;inset:auto 0 0 0;height:46%;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0));pointer-events:none}",
  ".lz-text{position:absolute;inset-inline-start:clamp(16px,4vw,56px);bottom:clamp(64px,10vh,96px);inset-inline-end:clamp(16px,4vw,56px);pointer-events:none}",
  ".lz-line{display:block;overflow:hidden;padding-bottom:.08em}",
  ".lz-line>span{display:block;animation:lz-rise .9s cubic-bezier(.2,.8,.2,1) both}",
  ".lz-title{font:600 clamp(34px,6vw,84px)/1.15 var(--font-display);letter-spacing:0}",
  ".lz-cap{margin-top:12px;font:400 15px/1.5 var(--font-sans);opacity:.82;max-width:44ch}",
  ".lz-cap>span{animation-delay:.08s}",
  ".lz-nav{position:absolute;inset-inline-end:clamp(16px,4vw,56px);bottom:clamp(16px,3vh,28px);display:flex;align-items:center;gap:14px}",
  ".lz-count{font:500 12px/1 var(--font-mono);letter-spacing:.14em}",
  ".lz-btn{appearance:none;width:44px;height:44px;border-radius:50%;border:1px solid color-mix(in srgb,var(--lz-ink) 45%,transparent);background:transparent;color:inherit;display:grid;place-items:center;cursor:pointer;transition:background .2s ease,color .2s ease}",
  ".lz-btn:hover{background:var(--lz-ink);color:#0e1412}",
  ".lz-btn:focus-visible{outline:2px solid var(--lz-ink);outline-offset:2px}",
  ".lz-track{position:absolute;inset-inline-start:clamp(16px,4vw,56px);inset-inline-end:clamp(140px,18vw,220px);bottom:clamp(36px,5vh,50px);height:1px;background:color-mix(in srgb,var(--lz-ink) 28%,transparent)}",
  ".lz-fill{height:100%;background:var(--lz-ink);transform-origin:left;transform:scaleX(0)}",
  ".lz-fill[data-run='1']{animation:lz-fill var(--lz-auto) linear forwards}",
  ".lz-root[data-paused='1'] .lz-fill{animation-play-state:paused}",
  ".lz-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
  "[dir=rtl] .lz-fill{transform-origin:right}",
  "[dir=rtl] .lz-btn svg{transform:scaleX(-1)}",
  ".lz-shade{height:62%;background:linear-gradient(to top,rgba(8,14,12,.78),rgba(8,14,12,0))}",
  "@keyframes lz-show{from{opacity:0}35%{opacity:1}to{opacity:1}}",
  "@keyframes lz-zoom{from{transform:scale(var(--lz-depth));filter:blur(14px) brightness(1.2)}to{transform:none;filter:none}}",
  "@keyframes lz-ghost{from{transform:scale(var(--lz-g));opacity:.4;filter:blur(6px)}to{transform:scale(1);opacity:0;filter:blur(0)}}",
  "@keyframes lz-rise{from{transform:translateY(105%)}to{transform:none}}",
  "@keyframes lz-fill{to{transform:scaleX(1)}}",
  "@keyframes lz-fade{from{opacity:0}to{opacity:1}}",
  "@media (prefers-reduced-motion:reduce){.lz-in,.lz-main{animation-name:lz-fade}.lz-ghost{display:none}.lz-line>span{animation:none}.lz-base{transition:none}}",
].join("\n")

export function LensZoomCarousel({
  slides,
  height = "100svh",
  duration = 1050,
  depth = 1.35,
  autoplay = 6000,
  ink = "#ffffff",
  onChange,
  className,
  style,
  ariaLabel = "Image carousel",
  rtl = false,
  labels = { prev: "Previous", next: "Next", slide: "Slide", of: "of" },
  children,
}: {
  slides: Slide[]
  height?: number | string
  duration?: number
  depth?: number
  autoplay?: number
  ink?: string
  onChange?: (index: number) => void
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
  rtl?: boolean
  labels?: { prev: string; next: string; slide: string; of: string }
  /** Sufra: extra overlay content (e.g. back button, favourite) */
  children?: React.ReactNode
}) {
  const sign = rtl ? -1 : 1
  const n = slides.length
  const srcs = slides.map((s) => s.image || "")
  const [index, setIndex] = React.useState(0)
  const [incoming, setIncoming] = React.useState(null as null | { to: number; dir: number; id: number })
  const [paused, setPaused] = React.useState(false)
  const rootRef = React.useRef(null as HTMLDivElement | null)
  const down = React.useRef(null as null | { x: number; y: number })

  const go = (dir: number) => {
    if (incoming || n < 2) return
    setIncoming({ to: wrap(index + dir, n), dir, id: Date.now() })
  }
  const commit = () => {
    if (!incoming) return
    setIndex(incoming.to)
    setIncoming(null)
  }
  React.useEffect(() => {
    onChange?.(index)
  }, [index, onChange])
  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let seen = true
    const sync = () => setPaused(!seen || document.hidden)
    const io = new IntersectionObserver(([e]) => {
      seen = e.isIntersecting
      sync()
    })
    io.observe(root)
    document.addEventListener("visibilitychange", sync)
    return () => {
      io.disconnect()
      document.removeEventListener("visibilitychange", sync)
    }
  }, [])
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") go(sign)
    else if (e.key === "ArrowLeft") go(-sign)
    else return
    e.preventDefault()
  }
  const onDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e: React.PointerEvent) => {
    const s = down.current
    down.current = null
    if (!s) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go((dx < 0 ? 1 : -1) * sign)
  }
  const shown = incoming ? incoming.to : index
  const s = slides[shown] || {}

  return (
    <div
      ref={rootRef}
      className={["lz-root", className].filter(Boolean).join(" ")}
      style={{ height, ["--lz-ink" as string]: ink, ["--lz-d" as string]: duration + "ms", ["--lz-auto" as string]: autoplay + "ms", ...style }}
      data-moving={incoming ? "1" : "0"}
      data-paused={paused ? "1" : "0"}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerUp={onUp}
    >
      <style>{LZ_CSS}</style>
      <div className="lz-base">{srcs[index] ? <img className="lz-img" src={srcs[index]} alt={slides[index]?.alt || slides[index]?.title || ""} draggable={false} /> : null}</div>
      {incoming ? (
        <div className="lz-in" key={incoming.id} style={{ ["--lz-depth" as string]: String(incoming.dir >= 0 ? depth : 1 / depth) }} onAnimationEnd={(e) => e.target === e.currentTarget && commit()} aria-hidden="true">
          {srcs[incoming.to] ? <img className="lz-img lz-main" src={srcs[incoming.to]} alt="" draggable={false} /> : null}
          {srcs[incoming.to]
            ? [1, 0].map((g) => (
                <img key={g} className="lz-img lz-ghost" src={srcs[incoming.to]} alt="" draggable={false} style={{ ["--lz-g" as string]: String(ghostScale(incoming.dir >= 0 ? depth : 1 / depth, g)), animationDelay: g * 40 + "ms" }} />
              ))
            : null}
        </div>
      ) : null}
      <div className="lz-shade" aria-hidden="true" />
      <div className="lz-text" key={"t" + shown} aria-hidden="true">
        {s.title ? <span className="lz-line lz-title"><span>{s.title}</span></span> : null}
        {s.caption ? <span className="lz-line lz-cap"><span>{s.caption}</span></span> : null}
      </div>
      <div className="lz-nav">
        <span className="lz-count" aria-hidden="true" dir="ltr">{pad2(shown + 1)} / {pad2(n)}</span>
        <button type="button" className="lz-btn" aria-label={labels.prev} onClick={() => go(-1)} onPointerDown={(e) => e.stopPropagation()}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
        <button type="button" className="lz-btn" aria-label={labels.next} onClick={() => go(1)} onPointerDown={(e) => e.stopPropagation()}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      </div>
      <div className="lz-track" aria-hidden="true">
        <div key={"f" + index} className="lz-fill" data-run={autoplay > 0 && n > 1 && !incoming ? "1" : "0"} onAnimationEnd={() => go(1)} />
      </div>
      {children}
      <div className="lz-sr" aria-live="polite">{labels.slide + " " + (shown + 1) + " " + labels.of + " " + n + (s.title ? ": " + s.title : "")}</div>
    </div>
  )
}

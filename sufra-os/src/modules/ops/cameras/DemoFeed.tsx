/**
 * Demo-mode camera tile: an animated, clearly-labelled PLACEHOLDER drawn on a canvas (abstract room + moving dots + a
 * running timestamp). It is never presented as footage — the "DEMO" banner is part of every frame.
 */
import { useEffect, useRef } from "react";
import { useReduced } from "@/ui";

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function DemoFeed({ seed, label, at, className }: { seed: string; label: string; /** fixed time (clip playback) instead of now */ at?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReduced();
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const r = rand(h);
    const tables = Array.from({ length: 3 + Math.floor(r() * 4) }, () => ({ x: 0.1 + r() * 0.75, y: 0.25 + r() * 0.55, w: 0.08 + r() * 0.08, round: r() > 0.5 }));
    const people = Array.from({ length: 2 + Math.floor(r() * 4) }, () => ({ x: r(), y: 0.3 + r() * 0.6, vx: (r() - 0.5) * 0.004, vy: (r() - 0.5) * 0.002, s: 0.018 + r() * 0.01 }));
    const hue = Math.floor(r() * 40) + 160;
    let raf = 0;
    let last = 0;
    const start = Date.now();
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 90) return;
      last = t;
      const W = (cv.width = cv.clientWidth * Math.min(2, devicePixelRatio || 1));
      const H = (cv.height = cv.clientHeight * Math.min(2, devicePixelRatio || 1));
      if (!W || !H) return;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsl(${hue} 12% 16%)`);
      g.addColorStop(1, `hsl(${hue} 14% 9%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // floor perspective lines
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        ctx.beginPath();
        ctx.moveTo((i / 10) * W, H * 0.22);
        ctx.lineTo(((i - 5) / 10) * W * 1.8 + W / 2, H);
        ctx.stroke();
      }
      for (let j = 0; j < 6; j++) {
        const y = H * (0.22 + (j / 6) ** 1.6 * 0.78);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      for (const tb of tables) {
        const x = tb.x * W;
        const y = tb.y * H;
        const w = tb.w * W;
        ctx.beginPath();
        if (tb.round) ctx.ellipse(x, y, w / 2, w / 3.2, 0, 0, Math.PI * 2);
        else ctx.rect(x - w / 2, y - w / 4, w, w / 2);
        ctx.fill();
      }
      if (!reduced && at === undefined) for (const p of people) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0.02 || p.x > 0.98) p.vx *= -1;
        if (p.y < 0.3 || p.y > 0.95) p.vy *= -1;
      }
      for (const p of people) {
        ctx.fillStyle = "rgba(210,225,220,0.35)";
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.s * W, 0, Math.PI * 2);
        ctx.fill();
      }
      // scanline noise
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      for (let y = (t / 40) % 4; y < H; y += 4) ctx.fillRect(0, y, W, 1);
      // overlays
      const fs = Math.max(10, Math.round(H / 18));
      ctx.font = `600 ${fs}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      const now = new Date(at !== undefined ? at + (Date.now() - start) : Date.now());
      const stamp = now.toLocaleString("en-GB", { hour12: false });
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(fs * 0.5, fs * 0.5, ctx.measureText(stamp).width + fs, fs * 1.6);
      ctx.fillStyle = "#e9efe9";
      ctx.fillText(stamp, fs, fs * 0.8);
      ctx.textAlign = "end";
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      const lw = ctx.measureText(label).width + fs;
      ctx.fillRect(W - lw - fs * 0.5, H - fs * 2.1, lw, fs * 1.6);
      ctx.fillStyle = "#e9efe9";
      ctx.fillText(label, W - fs, H - fs * 1.8);
      ctx.textAlign = "start";
      // the DEMO banner (always)
      const banner = "DEMO · ليس بثاً حقيقياً";
      ctx.font = `700 ${fs}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
      const bw = ctx.measureText(banner).width + fs * 1.2;
      ctx.fillStyle = "rgba(176,137,63,0.92)";
      ctx.fillRect(fs * 0.5, H - fs * 2.1, bw, fs * 1.6);
      ctx.fillStyle = "#1b1407";
      ctx.fillText(banner, fs * 1.1, H - fs * 1.8);
      if (reduced) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [seed, label, reduced, at]);
  return <canvas ref={ref} className={className ?? "size-full"} role="img" aria-label={`${label} — demo placeholder, not real footage`} />;
}

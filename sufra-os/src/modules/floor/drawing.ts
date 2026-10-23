/**
 * Architectural drawing → background layer.
 *  - Images (PNG/JPG/WebP/SVG) are downscaled to ≤ 2400 px and stored as a data URL on the zone.
 *  - PDFs: the first page is rendered with pdf.js, loaded on demand from a CDN (≈1 MB, only when a PDF is
 *    actually uploaded — nothing is added to the app bundle). Offline, PDFs fail with a clear message.
 */
import type { ZoneBackground } from "@/data/types";
import { detectTables, type Detected } from "./core/detect";

const MAX_SIDE = 2400;
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build";

export interface LoadedDrawing {
  src: string;
  pxW: number;
  pxH: number;
  fileName: string;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("image_failed"));
    img.src = src;
  });
}

function toDataUrl(canvas: HTMLCanvasElement) {
  // JPEG keeps big plans small; plans have no transparency that matters (we paint white first)
  return canvas.toDataURL("image/jpeg", 0.86);
}

function drawScaled(source: CanvasImageSource, w: number, h: number) {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

async function readAsDataUrl(file: File) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("read_failed"));
    r.readAsDataURL(file);
  });
}

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }> }> };
}

async function renderPdf(file: File): Promise<HTMLCanvasElement> {
  let pdfjs: PdfJs;
  try {
    pdfjs = (await import(/* @vite-ignore */ `${PDFJS}/pdf.min.mjs`)) as PdfJs;
  } catch {
    throw new Error("pdf_unavailable");
  }
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, MAX_SIDE / Math.max(v1.width, v1.height));
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

export async function loadDrawing(file: File): Promise<LoadedDrawing> {
  if (file.size > 20 * 1024 * 1024) throw new Error("too_big");
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const c = await renderPdf(file);
    const scaled = c.width > MAX_SIDE || c.height > MAX_SIDE ? drawScaled(c, c.width, c.height) : c;
    return { src: toDataUrl(scaled), pxW: scaled.width, pxH: scaled.height, fileName: file.name };
  }
  const raw = await readAsDataUrl(file);
  const img = await loadImage(raw);
  const w = img.naturalWidth || 1600;
  const h = img.naturalHeight || 1000;
  const c = drawScaled(img, w, h);
  return { src: toDataUrl(c), pxW: c.width, pxH: c.height, fileName: file.name };
}

/** First background for a zone: the drawing spans the zone's width. */
export function initialBackground(d: LoadedDrawing, zoneWidth: number): ZoneBackground {
  return { src: d.src, pxW: d.pxW, pxH: d.pxH, cmPerPx: zoneWidth / d.pxW, x: 0, y: 0, opacity: 0.55, visible: true, locked: true, fileName: d.fileName };
}

/** Scale from a line drawn on the floor (cm, at the current scale) whose real length is `meters`. */
export function calibrate(bg: ZoneBackground, lineCm: number, meters: number): ZoneBackground {
  const linePx = lineCm / bg.cmPerPx;
  return { ...bg, cmPerPx: (meters * 100) / linePx };
}

/** Run the beta detector on a downscaled copy of the drawing; results in floor centimetres. */
export async function suggestFromDrawing(bg: ZoneBackground): Promise<(Detected & { id: string })[]> {
  const img = await loadImage(bg.src);
  const s = Math.min(1, 900 / Math.max(bg.pxW, bg.pxH));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bg.pxW * s));
  c.height = Math.max(1, Math.round(bg.pxH * s));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const cmPerPx = bg.cmPerPx / s;
  await new Promise((r) => setTimeout(r, 16)); // let the spinner paint
  const found = detectTables({ width: c.width, height: c.height, data: data.data }, { cmPerPx });
  return found.map((d, i) => ({
    ...d,
    id: `sug${i}`,
    x: bg.x + d.x * cmPerPx,
    y: bg.y + d.y * cmPerPx,
    w: Math.max(40, Math.round((d.w * cmPerPx) / 10) * 10),
    h: Math.max(40, Math.round((d.h * cmPerPx) / 10) * 10),
  }));
}

/** A demo plan (SVG) — used by the screenshot script and handy for trying the tracer without a file. */
export function demoPlanSvg() {
  const rects = [
    [120, 120, 80, 80], [300, 120, 80, 80], [480, 120, 80, 80], [120, 330, 160, 80], [380, 330, 160, 80],
  ];
  const circles = [[760, 160, 55], [760, 400, 55]];
  const body = [
    `<rect x="20" y="20" width="960" height="620" fill="none" stroke="#222" stroke-width="10"/>`,
    `<line x1="600" y1="20" x2="600" y2="260" stroke="#222" stroke-width="8"/>`,
    `<rect x="700" y="560" width="240" height="60" fill="none" stroke="#222" stroke-width="3"/>`,
    ...rects.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#333" stroke-width="3"/>`),
    ...circles.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#333" stroke-width="3"/>`),
    `<text x="40" y="610" font-family="sans-serif" font-size="22" fill="#555">GROUND FLOOR — 1:50</text>`,
  ].join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="660" viewBox="0 0 1000 660"><rect width="1000" height="660" fill="#fdfcf8"/>${body}</svg>`)}`;
}

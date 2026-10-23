/**
 * BETA — "suggest tables" from an architectural drawing, entirely in the browser.
 *
 * A deliberately small heuristic (no model, no network) that works on clean CAD exports and
 * plain scanned plans, and fails gracefully (finds nothing) on sketches or photos:
 *
 *   1. grey-scale and split ink from paper with Otsu's threshold, then thicken ink by 1px so
 *      hairline gaps in outlines still close;
 *   2. label connected regions of paper (4-connected). A region that does not touch the image
 *      border is *enclosed by ink* — the inside of a drawn table, chair, room or column;
 *      also label solid ink blobs (filled table symbols);
 *   3. keep regions whose real size (via the calibrated cm-per-pixel) is table-like
 *      (45–320 cm per side, aspect ≤ 4); rooms are too big, chairs/text too small;
 *   4. classify by how much of the bounding box the region fills: ≈1 → rectangle/square,
 *      ≈π/4 → round/oval; anything else (L-shapes, text, stairs) is dropped.
 *
 * Results are suggestions the person accepts or deletes on the canvas.
 */
import type { Shape } from "./types";

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major (ImageData.data) */
  data: Uint8ClampedArray | Uint8Array;
}

export interface Detected {
  shape: Shape;
  /** centre and size in *pixels* of the raster */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1 — how cleanly the region matched its shape */
  confidence: number;
}

export interface DetectOptions {
  /** centimetres per raster pixel (from the scale calibration) */
  cmPerPx: number;
  minCm?: number;
  maxCm?: number;
  maxResults?: number;
}

export function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** ink mask: 1 = drawn line / filled symbol */
export function inkMask(img: Raster): Uint8Array {
  const n = img.width * img.height;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3] / 255;
    // transparent pixels are paper
    const v = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    gray[i] = Math.round(v * a + 255 * (1 - a));
  }
  const thr = Math.min(otsu(gray), 200);
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) ink[i] = gray[i] <= thr ? 1 : 0;
  // thicken by one pixel (closes 1px gaps in outlines)
  const out = new Uint8Array(ink);
  const { width: W, height: H } = img;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (ink[y * W + x]) continue;
      if ((x > 0 && ink[y * W + x - 1]) || (x < W - 1 && ink[y * W + x + 1]) || (y > 0 && ink[(y - 1) * W + x]) || (y < H - 1 && ink[(y + 1) * W + x])) out[y * W + x] = 1;
    }
  return out;
}

interface Region {
  area: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  border: boolean;
}

/** Connected regions of pixels where mask[i] === value (4-connected, iterative). */
export function regions(mask: Uint8Array, W: number, H: number, value: 0 | 1): Region[] {
  const label = new Int32Array(W * H).fill(-1);
  const out: Region[] = [];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (mask[start] !== value || label[start] !== -1) continue;
    const id = out.length;
    const r: Region = { area: 0, x1: W, y1: H, x2: -1, y2: -1, border: false };
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp) {
      const i = stack[--sp];
      const x = i % W;
      const y = (i - x) / W;
      r.area++;
      if (x < r.x1) r.x1 = x;
      if (x > r.x2) r.x2 = x;
      if (y < r.y1) r.y1 = y;
      if (y > r.y2) r.y2 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) r.border = true;
      if (x > 0 && mask[i - 1] === value && label[i - 1] === -1) (label[i - 1] = id), (stack[sp++] = i - 1);
      if (x < W - 1 && mask[i + 1] === value && label[i + 1] === -1) (label[i + 1] = id), (stack[sp++] = i + 1);
      if (y > 0 && mask[i - W] === value && label[i - W] === -1) (label[i - W] = id), (stack[sp++] = i - W);
      if (y < H - 1 && mask[i + W] === value && label[i + W] === -1) (label[i + W] = id), (stack[sp++] = i + W);
    }
    out.push(r);
  }
  return out;
}

function classify(r: Region, opts: Required<Pick<DetectOptions, "cmPerPx" | "minCm" | "maxCm">>, pad: number): Detected | null {
  const bw = r.x2 - r.x1 + 1;
  const bh = r.y2 - r.y1 + 1;
  const wCm = (bw + pad * 2) * opts.cmPerPx;
  const hCm = (bh + pad * 2) * opts.cmPerPx;
  if (wCm < opts.minCm || hCm < opts.minCm || wCm > opts.maxCm || hCm > opts.maxCm) return null;
  const aspect = Math.max(bw, bh) / Math.min(bw, bh);
  if (aspect > 4) return null;
  const fill = r.area / (bw * bh);
  let shape: Shape;
  let confidence: number;
  if (fill >= 0.9) {
    shape = aspect > 1.2 ? "rect" : "square";
    confidence = Math.min(1, (fill - 0.9) / 0.08 + 0.5);
  } else if (fill >= 0.7 && fill <= 0.86) {
    shape = aspect > 1.15 ? "oval" : "round";
    confidence = 1 - Math.abs(fill - Math.PI / 4) / 0.08;
  } else return null;
  return { shape, x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2, w: bw + pad * 2, h: bh + pad * 2, confidence: Math.max(0.2, Math.min(1, confidence)) };
}

export function detectTables(img: Raster, o: DetectOptions): Detected[] {
  const opts = { cmPerPx: o.cmPerPx, minCm: o.minCm ?? 45, maxCm: o.maxCm ?? 320 };
  const { width: W, height: H } = img;
  const ink = inkMask(img);
  const found: Detected[] = [];
  // enclosed paper (outlined symbols): grow by the outline thickness (~2px after thickening)
  for (const r of regions(ink, W, H, 0)) if (!r.border) {
    const d = classify(r, opts, 1.5);
    if (d) found.push(d);
  }
  // solid ink blobs (filled symbols)
  for (const r of regions(ink, W, H, 1)) {
    const d = classify(r, opts, -0.5);
    if (d) found.push(d);
  }
  // drop a detection that sits inside a bigger one (e.g. a table drawn inside a rug)
  const keep = found
    .sort((a, b) => b.confidence - a.confidence)
    .filter((d, i, all) => !all.some((o2, j) => j < i && Math.abs(o2.x - d.x) < (o2.w + d.w) / 4 && Math.abs(o2.y - d.y) < (o2.h + d.h) / 4));
  return keep.slice(0, o.maxResults ?? 60);
}

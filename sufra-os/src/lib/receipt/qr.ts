/**
 * QR codes for receipts (ETA e-receipt link). Encoded in the browser with qrcode-generator (MIT, no deps);
 * rendered as one SVG path so it prints crisp on thermal paper at any DPI.
 */
import qrcode from "qrcode-generator";

export interface QrMatrix {
  size: number;
  /** SVG path data, one unit per module, no quiet zone */
  path: string;
}

export function qrMatrix(text: string, level: "L" | "M" | "Q" | "H" = "M"): QrMatrix {
  const qr = qrcode(0, level);
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      d += `M${start} ${r}h${c - start}v1h${start - c}z`;
    }
  }
  return { size: n, path: d };
}

/** Standalone SVG markup (quiet zone of 4 modules). */
export function qrSvg(text: string, opts: { level?: "L" | "M" | "Q" | "H"; color?: string } = {}): string {
  const { size, path } = qrMatrix(text, opts.level);
  const q = 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-q} ${-q} ${size + 2 * q} ${size + 2 * q}" shape-rendering="crispEdges"><rect x="${-q}" y="${-q}" width="${size + 2 * q}" height="${size + 2 * q}" fill="#fff"/><path d="${path}" fill="${opts.color ?? "#000"}"/></svg>`;
}

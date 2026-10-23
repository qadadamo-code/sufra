import { useMemo } from "react";
import { encodeQr, qrPath, type Ecc } from "./qrcode";

/** Crisp vector QR (prints sharp at any size). Quiet zone of 4 modules included. */
export function QrSvg({ value, ecc = "M", className, fg = "currentColor", bg = "transparent", title }: { value: string; ecc?: Ecc; className?: string; fg?: string; bg?: string; title?: string }) {
  const { path, n } = useMemo(() => {
    const qr = encodeQr(value, ecc);
    return { path: qrPath(qr, 4), n: qr.size + 8 };
  }, [value, ecc]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className={className} role="img" aria-label={title ?? value} shapeRendering="crispEdges">
      <rect width={n} height={n} fill={bg} />
      <path d={path} fill={fg} />
    </svg>
  );
}

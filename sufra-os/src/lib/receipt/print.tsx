/**
 * Print a receipt (or any paper-sized node) with the browser's print dialog: the node is rendered into a dedicated
 * root, a print stylesheet hides everything else and sets the page size, then `window.print()`.
 * Thermal printers installed as system printers (Epson/Xprinter drivers, Sunmi built-in) print this directly;
 * ESC/POS raster over LAN is a later hardware bridge.
 */
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { InvoiceDesign } from "@/data/types";
import { PAPER_MM } from "./design";

const ROOT_ID = "sf-print-root";

export function printNode(node: ReactNode, paper: InvoiceDesign["paper"] = "80"): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(`${ROOT_ID}-css`)?.remove();
  const host = document.createElement("div");
  host.id = ROOT_ID;
  const css = document.createElement("style");
  css.id = `${ROOT_ID}-css`;
  const size = paper === "a4" ? "A4" : `${PAPER_MM[paper]}mm auto`;
  css.textContent = `
#${ROOT_ID}{position:fixed;inset:auto auto 0 -10000px;}
@media print{
  @page{size:${size};margin:0}
  html,body{background:#fff!important;height:auto!important;overflow:visible!important}
  body>*:not(#${ROOT_ID}){display:none!important}
  #${ROOT_ID}{position:static!important;display:block!important}
}`;
  document.head.appendChild(css);
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<>{node}</>));
  const imgs = [...host.querySelectorAll("img")].filter((i) => !i.complete);
  return Promise.all(imgs.map((i) => new Promise((r) => ((i.onload = r), (i.onerror = r))))).then(
    () =>
      new Promise<void>((resolve) => {
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          window.removeEventListener("afterprint", done);
          setTimeout(() => {
            root.unmount();
            host.remove();
            css.remove();
            resolve();
          }, 50);
        };
        window.addEventListener("afterprint", done);
        // fonts first, so Arabic shapes with the receipt face
        const ready = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
        ready.then(() => {
          try {
            window.print();
          } finally {
            // some browsers never fire afterprint (or print is blocked in headless/kiosk)
            setTimeout(done, 1500);
          }
        });
      }),
  );
}

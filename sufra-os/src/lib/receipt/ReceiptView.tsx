/**
 * Receipt / invoice renderer: 58 mm and 80 mm thermal, A4. Pure HTML/CSS in physical units, so the on-screen preview,
 * the designer and `window.print()` produce the same thing. Paper is always white-on-black (thermal is monochrome);
 * the accent colour only shows on A4.
 */
import { Fragment, useMemo, type ReactNode } from "react";
import { formatMoney, type Units } from "@/lib/money";
import type { Localized } from "@/data/types";
import { PAPER_MM } from "./design";
import type { ReceiptModel } from "./model";
import { qrMatrix } from "./qr";

const CSS = `
.sfr{--sfr-fs:12px;background:#fff;color:#000;font-family:"IBM Plex Sans Arabic",system-ui,sans-serif;font-size:var(--sfr-fs);line-height:1.35;box-sizing:border-box;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sfr *{box-sizing:border-box}
.sfr .n{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate;white-space:nowrap}
.sfr .c{text-align:center}
.sfr .muted{color:#333}
.sfr .en{display:block;font-size:.82em;color:#222;direction:ltr}
.sfr[dir=rtl] .en{text-align:right}
.sfr .c .en{text-align:center}
.sfr .hr{border:0;border-top:1px dashed #000;margin:2.2mm 0}
.sfr .hr2{border:0;border-top:2px solid #000;margin:2mm 0}
.sfr .row{display:flex;justify-content:space-between;align-items:baseline;gap:2mm}
.sfr .row>:first-child{min-width:0}
.sfr .brand{font-weight:700;font-size:1.32em;line-height:1.2}
.sfr .title{margin:2mm 0 1mm;padding:1mm 0;border-top:1px solid #000;border-bottom:1px solid #000;font-weight:700;text-align:center}
.sfr .logo{display:block;margin:0 auto 1.5mm;max-height:18mm;max-width:70%;object-fit:contain;filter:grayscale(1) contrast(1.2)}
.sfr .item{margin:0 0 1.4mm}
.sfr .item .nm{font-weight:600}
.sfr .item .sub{padding-inline-start:3mm;font-size:.88em;color:#222}
.sfr .tot .row{padding:.3mm 0}
.sfr .tot .strong{font-weight:700;font-size:1.25em;border-top:1px solid #000;border-bottom:1px solid #000;padding:1mm 0;margin:1mm 0}
.sfr .qr{display:block;margin:1.5mm auto}
.sfr .uuid{font-size:.72em;word-break:break-all;white-space:normal;text-align:center}
.sfr .tiny{font-size:.7em;color:#444;text-align:center;margin-top:2mm}
.sfr.a4{padding:14mm 14mm 12mm}
.sfr.a4 .head{display:flex;justify-content:space-between;gap:8mm;align-items:flex-start}
.sfr.a4 .logo{margin:0;max-height:22mm;max-width:50mm;filter:none}
.sfr.a4 .band{margin:6mm 0 4mm;padding:2.5mm 4mm;color:#fff;font-weight:700;font-size:1.25em;border-radius:2mm;display:flex;justify-content:space-between}
.sfr.a4 .grid{display:grid;grid-template-columns:1fr 1fr;gap:1mm 10mm}
.sfr.a4 table{width:100%;border-collapse:collapse;margin-top:5mm}
.sfr.a4 th{text-align:start;font-size:.85em;border-bottom:2px solid #000;padding:1.5mm 1mm}
.sfr.a4 td{border-bottom:1px solid #ccc;padding:1.8mm 1mm;vertical-align:top}
.sfr.a4 .tot{width:80mm;margin-inline-start:auto;margin-top:4mm}
.sfr.a4 .foot{display:flex;gap:6mm;align-items:center;margin-top:8mm;border-top:1px solid #ccc;padding-top:4mm}
.sfr.a4 .qr{margin:0}
.sfr.a4 .uuid{text-align:start}
`;

function Bi({ v, lang, inline }: { v: Localized | string; lang: ReceiptModel["language"]; inline?: boolean }) {
  if (typeof v === "string") return <>{v}</>;
  if (lang === "ar") return <>{v.ar}</>;
  if (lang === "en") return <>{v.en}</>;
  if (inline || v.ar === v.en) return <>{v.ar === v.en ? v.ar : `${v.ar} · ${v.en}`}</>;
  return (
    <>
      {v.ar}
      <span className="en">{v.en}</span>
    </>
  );
}

function Qr({ text, mm }: { text: string; mm: number }) {
  const m = useMemo(() => qrMatrix(text, "M"), [text]);
  const q = 2;
  return (
    <svg className="qr" viewBox={`${-q} ${-q} ${m.size + 2 * q} ${m.size + 2 * q}`} style={{ width: `${mm}mm`, height: `${mm}mm` }} shapeRendering="crispEdges" role="img" aria-label="ETA QR">
      <rect x={-q} y={-q} width={m.size + 2 * q} height={m.size + 2 * q} fill="#fff" />
      <path d={m.path} fill="#000" />
    </svg>
  );
}

export function ReceiptView({ model, className, style }: { model: ReceiptModel; className?: string; style?: React.CSSProperties }) {
  const { design, language: lang } = model;
  const dir = lang === "en" ? "ltr" : "rtl";
  const moneyLang = lang === "en" ? "en" : "ar";
  const M = (u: Units, opts: { bare?: boolean } = {}) => <span className="n">{formatMoney(u, { lang: moneyLang, bare: opts.bare ?? true })}</span>;
  const a4 = design.paper === "a4";
  const width = PAPER_MM[design.paper];
  const fs = a4 ? Math.round(design.fontSize * 1.05) : design.fontSize;
  const pad = design.paper === "58" ? "2.5mm 2mm" : "3.5mm 4mm";

  const brand = (
    <div className={a4 ? "" : "c"}>
      {model.brand.logo ? <img className="logo" src={model.brand.logo} alt="" /> : null}
      <div className="brand">
        <Bi v={model.brand.header.ar || model.brand.header.en ? model.brand.header : model.brand.name} lang={lang} />
      </div>
      {model.brand.branch ? (
        <div className="muted">
          <Bi v={model.brand.branch} lang={lang} inline />
        </div>
      ) : null}
      {model.brand.address ? (
        <div className="muted">
          <Bi v={model.brand.address} lang={lang} />
        </div>
      ) : null}
      {model.brand.phone ? <div className="n muted">{model.brand.phone}</div> : null}
    </div>
  );

  const rows = (list: ReceiptModel["meta"]) =>
    list.map((r, i) => (
      <div className="row" key={i}>
        <span className="muted">
          <Bi v={r.label} lang={lang} inline />
        </span>
        <span className={r.mono ? "n" : undefined} style={{ textAlign: "end" }}>
          <Bi v={r.value} lang={lang} inline />
        </span>
      </div>
    ));

  const totals = (
    <div className="tot">
      {model.totals.map((t, i) => (
        <div className={t.strong ? "row strong" : "row"} key={i} style={t.key === "includes" ? { fontSize: ".85em", color: "#333" } : undefined}>
          <span>
            <Bi v={t.label} lang={lang} inline />
          </span>
          {M(t.amount, { bare: !t.strong })}
        </div>
      ))}
      {model.payments.length ? <div className="hr" /> : null}
      {model.payments.map((p, i) => (
        <Fragment key={i}>
          <div className="row">
            <span>
              <Bi v={p.label} lang={lang} inline />
            </span>
            {M(p.amount)}
          </div>
          {p.tip ? (
            <div className="row muted" style={{ fontSize: ".88em" }}>
              <span>
                <Bi v={{ ar: "إكرامية", en: "Tip" }} lang={lang} inline />
              </span>
              {M(p.tip)}
            </div>
          ) : null}
        </Fragment>
      ))}
      {model.tendered != null ? (
        <div className="row">
          <span>
            <Bi v={{ ar: "المدفوع كاش", en: "Cash tendered" }} lang={lang} inline />
          </span>
          {M(model.tendered)}
        </div>
      ) : null}
      {model.change != null ? (
        <div className="row" style={{ fontWeight: 700 }}>
          <span>
            <Bi v={{ ar: "الباقي", en: "Change" }} lang={lang} inline />
          </span>
          {M(model.change)}
        </div>
      ) : null}
    </div>
  );

  const eta = model.eta ? (
    <div className={a4 ? "" : "c"}>
      <Qr text={model.eta.qr} mm={a4 ? 30 : design.paper === "58" ? 30 : 36} />
      {design.fields.etaUuid ? <div className="uuid n">{model.eta.uuid}</div> : null}
    </div>
  ) : null;

  const footer: ReactNode = model.footer.ar || model.footer.en ? (
    <div className="c" style={{ marginTop: "2mm", fontWeight: 600 }}>
      <Bi v={model.footer} lang={lang} />
    </div>
  ) : null;

  return (
    <div
      className={`sfr ${a4 ? "a4" : "thermal"} ${className ?? ""}`}
      dir={dir}
      lang={lang === "en" ? "en" : "ar"}
      style={{ width: `${width}mm`, padding: a4 ? undefined : pad, ["--sfr-fs" as string]: `${fs}px`, ...style }}
      data-paper={design.paper}
    >
      <style>{CSS}</style>
      {a4 ? (
        <>
          <div className="head">
            {brand}
            <div style={{ minWidth: "60mm" }}>{rows(model.legal)}</div>
          </div>
          <div className="band" style={{ background: design.accent }}>
            <span>
              <Bi v={model.title} lang={lang} inline />
            </span>
            {model.meta[0] ? <span className="n">{typeof model.meta[0].value === "string" ? model.meta[0].value : ""}</span> : null}
          </div>
          <div className="grid">{rows(model.meta)}</div>
          <table>
            <thead>
              <tr>
                <th>
                  <Bi v={{ ar: "الصنف", en: "Item" }} lang={lang} inline />
                </th>
                <th style={{ textAlign: "center" }}>
                  <Bi v={{ ar: "الكمية", en: "Qty" }} lang={lang} inline />
                </th>
                <th style={{ textAlign: "end" }}>
                  <Bi v={{ ar: "السعر", en: "Unit" }} lang={lang} inline />
                </th>
                <th style={{ textAlign: "end" }}>
                  <Bi v={{ ar: "القيمة", en: "Amount" }} lang={lang} inline />
                </th>
              </tr>
            </thead>
            <tbody>
              {model.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      <Bi v={l.name} lang={lang} inline />
                    </div>
                    {l.modifiers.length ? <div className="muted" style={{ fontSize: ".88em" }}>+ {l.modifiers.map((m) => (lang === "en" ? m.en : m.ar)).join("، ")}</div> : null}
                    {l.notes ? <div className="muted" style={{ fontSize: ".88em", fontStyle: "italic" }}>{l.notes}</div> : null}
                  </td>
                  <td className="n" style={{ textAlign: "center" }}>
                    {l.qty}
                  </td>
                  <td style={{ textAlign: "end" }}>{M(l.unitPrice)}</td>
                  <td style={{ textAlign: "end" }}>{M(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totals}
          <div className="foot">
            {eta}
            <div style={{ flex: 1 }}>
              {footer}
              <div className="tiny" style={{ textAlign: "start" }}>
                Sufra OS · {model.issuedAt.slice(0, 10)}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {brand}
          <div className="title">
            <Bi v={model.title} lang={lang} />
          </div>
          {model.legal.length ? rows(model.legal) : null}
          <div className="hr" />
          {rows(model.meta)}
          <div className="hr" />
          {model.lines.map((l, i) => (
            <div className="item" key={i}>
              <div className="nm">
                <Bi v={l.name} lang={lang} />
              </div>
              <div className="row">
                <span className="n muted">
                  {l.qty} × {formatMoney(l.unitPrice, { lang: moneyLang, bare: true })}
                </span>
                {M(l.amount)}
              </div>
              {l.modifiers.map((m, j) => (
                <div className="sub" key={j}>
                  + <Bi v={m} lang={lang} inline />
                </div>
              ))}
              {l.notes ? (
                <div className="sub" style={{ fontStyle: "italic" }}>
                  “{l.notes}”
                </div>
              ) : null}
            </div>
          ))}
          <div className="hr" />
          {totals}
          {eta ? <div className="hr" /> : null}
          {eta}
          {footer}
          <div className="tiny">Sufra OS</div>
        </>
      )}
    </div>
  );
}

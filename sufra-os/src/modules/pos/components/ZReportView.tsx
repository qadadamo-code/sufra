/** X / Z report on thermal paper (same physical-unit approach as the receipt renderer). */
import type { Localized } from "@/data/types";
import { formatMoney, type Units } from "@/lib/money";
import { formatStamp, METHOD_LABEL } from "@/lib/receipt/model";
import type { ZReportU } from "../sale";

const CSS = `
.sfz{background:#fff;color:#000;font-family:"IBM Plex Sans Arabic",system-ui,sans-serif;font-size:12px;line-height:1.4;width:80mm;padding:4mm;box-sizing:border-box}
.sfz *{box-sizing:border-box}
.sfz .n{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate;white-space:nowrap}
.sfz h1{font-size:16px;margin:0;text-align:center}
.sfz h2{font-size:12.5px;margin:2.5mm 0 1mm;border-bottom:1px solid #000;padding-bottom:.5mm}
.sfz .row{display:flex;justify-content:space-between;gap:2mm}
.sfz .big{font-weight:700;font-size:14px}
.sfz .c{text-align:center}
.sfz .hr{border-top:1px dashed #000;margin:2mm 0}
`;

export function ZReportView({ z, kind, zNumber, restaurant, cashier, lang, categoryName }: { z: ZReportU; kind: "X" | "Z"; zNumber: number | null; restaurant: Localized; cashier: string | null; lang: "ar" | "en"; categoryName: (id: string) => string }) {
  const L = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const M = (u: Units | null) => <span className="n">{u == null ? "—" : formatMoney(u, { lang, bare: true })}</span>;
  /** money row (Units) */
  const R = ({ l, v, big }: { l: string; v: Units | null; big?: boolean }) => (
    <div className={big ? "row big" : "row"}>
      <span>{l}</span>
      {M(v)}
    </div>
  );
  /** text / count row */
  const T = ({ l, v }: { l: string; v: string | number }) => (
    <div className="row">
      <span>{l}</span>
      <span className="n">{v}</span>
    </div>
  );
  return (
    <div className="sfz" dir={lang === "ar" ? "rtl" : "ltr"}>
      <style>{CSS}</style>
      <h1>{restaurant[lang]}</h1>
      <div className="c big">{kind === "Z" ? L(`تقرير Z رقم ${zNumber ?? ""}`, `Z report #${zNumber ?? ""}`) : L("تقرير X (منتصف الوردية)", "X report (mid-shift)")}</div>
      <div className="hr" />
      <T l={L("الجهاز", "Device")} v={z.device} />
      <T l={L("من", "From")} v={formatStamp(z.openedAt)} />
      <T l={L("إلى", "To")} v={formatStamp(z.closedAt)} />
      {cashier ? <T l={L("الكاشير", "Cashier")} v={cashier} /> : null}
      <T l={L("إيصالات", "Receipts")} v={z.firstNumber == null ? "—" : `${z.firstNumber} → ${z.lastNumber}`} />
      <h2>{L("المبيعات", "Sales")}</h2>
      <T l={L("عدد", "Count")} v={z.sales.count} />
      <R l={L("صافي", "Net")} v={z.sales.net} />
      <R l={L("خصومات", "Discounts")} v={z.sales.discount} />
      <R l={L("خدمة", "Service")} v={z.sales.service} />
      <R l={L("ضريبة ق.م", "VAT")} v={z.sales.vat} />
      <R l={L("توصيل", "Delivery")} v={z.sales.delivery} />
      <R l={L("الإجمالي", "Total")} v={z.sales.total} big />
      <h2>{L("المرتجعات", "Returns")}</h2>
      <T l={L("عدد", "Count")} v={z.returns.count} />
      <R l={L("الإجمالي", "Total")} v={z.returns.total} />
      <h2>{L("بطريقة الدفع (صافي)", "By tender (net)")}</h2>
      {Object.entries(z.byMethod)
        .filter(([, v]) => v)
        .map(([m, v]) => (
          <R key={m} l={METHOD_LABEL[m as keyof typeof METHOD_LABEL]?.[lang] ?? m} v={v} />
        ))}
      <R l={L("إكراميات", "Tips")} v={z.tips} />
      <h2>{L("بالقسم (صافي)", "By station (net)")}</h2>
      {Object.entries(z.byCategory).map(([c, v]) => (
        <R key={c} l={categoryName(c)} v={v} />
      ))}
      <h2>{L("الدرج", "Drawer")}</h2>
      <R l={L("رصيد أول الوردية", "Opening float")} v={z.cash.opening} />
      <R l={L("مبيعات كاش", "Cash sales")} v={z.cash.sales} />
      <R l={L("مرتجع كاش", "Cash refunds")} v={-z.cash.refunds} />
      <R l={L("إيداع", "Paid in")} v={z.cash.moveIn} />
      <R l={L("صرف", "Paid out")} v={-z.cash.moveOut} />
      <R l={L("المتوقع في الدرج", "Expected")} v={z.cash.expected} big />
      {z.cash.counted != null ? (
        <>
          <R l={L("المعدود", "Counted")} v={z.cash.counted} />
          <R l={(z.cash.difference ?? 0) >= 0 ? L("زيادة", "Over") : L("عجز", "Short")} v={z.cash.difference} big />
        </>
      ) : null}
      <h2>{L("الضريبة", "Tax")}</h2>
      <R l={L("ضريبة ق.م مستحقة", "VAT due")} v={z.vatDue} big />
      <R l={L("فروق تقريب", "Rounding")} v={z.rounding} />
      <div className="hr" />
      <div className="c" style={{ fontSize: 10 }}>
        Sufra OS · {formatStamp(new Date().toISOString())}
      </div>
    </div>
  );
}

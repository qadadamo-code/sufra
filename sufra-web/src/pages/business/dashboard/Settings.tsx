import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { load, save } from "@/lib/storage";
import { notify } from "@/lib/notify";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { Card, Field, Money, Segmented, Toggle } from "@/components/business/kit";
import { DEFAULT_TAX, previewBill, type TaxSettings } from "@/data/business/tax";
import { resetBizDemo } from "@/data/business/store";
import { validRin } from "@/data/business/tax";

const KEY = "sufra.biz.tax.v1";

export default function Settings() {
  const { L } = useLang();
  const [s, setS] = useState<TaxSettings>(() => ({ ...DEFAULT_TAX, ...load<Partial<TaxSettings>>(KEY, {}) }));
  useEffect(() => save(KEY, s), [s]);
  const up = <K extends keyof TaxSettings>(k: K, v: TaxSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const [price, setPrice] = useState(185);
  const [mode, setMode] = useState<"dine-in" | "takeaway" | "delivery">("dine-in");
  const p = previewBill(Math.round(price * 100), mode, s);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="grid content-start gap-5">
        <Card>
          <h3 className="font-sans text-[16px] font-bold">{L("إعدادات الضرايب", "Tax settings")}</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">{L("نفس خيارات المحرك المالي. راجعها مع المحاسب قبل التشغيل الفعلي.", "The same options as the finance core. Confirm them with your accountant before going live.")}</p>
          <div className="mt-4 grid gap-3">
            <Toggle checked={s.vatRegistered} onChange={(v) => up("vatRegistered", v)} label={L("مسجّل في ضريبة القيمة المضافة", "VAT registered")} sub={L("المطاعم غير السياحية معفاة إلا لو قرار 82/2017 أو 285/2021 بينطبق (مول، سلسلة، بيع على تطبيقات، خدمة…)", "Non-tourist restaurants are exempt unless Decrees 82/2017 / 285/2021 apply (mall, chain, app sales, service charge…)")} />
            {s.vatRegistered ? (
              <Field label={L("رقم التسجيل الضريبي (RIN)", "Tax registration number (RIN)")} hint={!validRin(s.rin) ? L("لازم 9 أرقام", "Must be 9 digits") : undefined}>
                <input className="sf-input num" dir="ltr" inputMode="numeric" value={s.rin} onChange={(e) => up("rin", e.target.value.replace(/[^\d-]/g, ""))} aria-invalid={!validRin(s.rin)} />
              </Field>
            ) : null}
            <Field label={L("نسبة الخدمة", "Service charge")}>
              <Segmented label={L("نسبة الخدمة", "Service charge")} value={String(s.serviceRate)} onChange={(v) => up("serviceRate", Number(v))} options={[{ id: "0", label: L("من غير", "None") }, { id: "1000", label: "10%" }, { id: "1200", label: "12%" }]} />
            </Field>
            <Toggle checked={s.serviceDineInOnly} onChange={(v) => up("serviceDineInOnly", v)} label={L("الخدمة للصالة بس", "Service on dine-in only")} sub={L("مفيش خدمة على التيك أواي والتوصيل", "No service on takeaway and delivery")} />
            <Field label={L("الضريبة على الخدمة", "VAT on the service charge")}>
              <Segmented label={L("كود الخدمة", "Service code")} value={s.serviceCode} onChange={(v) => up("serviceCode", v)} options={[{ id: "T9", label: L("T9 · داخل وعاء الضريبة", "T9 · inside VAT base") }, { id: "T17", label: L("T17 · خارج الوعاء", "T17 · outside") }]} />
            </Field>
            <Field label={L("أسعار المنيو", "Menu prices")}>
              <Segmented label={L("أسعار المنيو", "Menu prices")} value={s.priceMode} onChange={(v) => up("priceMode", v)} options={[{ id: "exclusive", label: L("قبل الضريبة والخدمة", "Before tax & service") }, { id: "inclusive", label: L("شاملة", "Inclusive") }]} />
            </Field>
            <Field label={L("كود النشاط", "Activity code")}>
              <Segmented label={L("كود النشاط", "Activity code")} value={s.activity} onChange={(v) => up("activity", v)} options={[{ id: "5610", label: L("5610 · مطاعم", "5610 · Restaurants") }, { id: "5630", label: L("5630 · مشروبات", "5630 · Beverages") }]} />
            </Field>
            <Toggle checked={s.vatOnDelivery} onChange={(v) => up("vatOnDelivery", v)} label={L("ضريبة على رسوم التوصيل", "VAT on delivery fee")} />
            <Toggle checked={s.autoSubmit} onChange={(v) => up("autoSubmit", v)} label={L("ابعت الإيصالات الإلكترونية تلقائيًا", "Auto-submit e-receipts")} sub={L("أول ما يكون فيه نت، وقبل مهلة الـ 24 ساعة", "As soon as online, well inside the 24-hour window")} />
          </div>
        </Card>
        <Card>
          <h3 className="font-sans text-[16px] font-bold">{L("بيانات الديمو", "Demo data")}</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">{L("رجّع الطلبات والسلات وطلبات الموردين لحالتها الأولى.", "Reset orders, carts and supplier orders to their initial state.")}</p>
          <HoldToConfirm
            className="mt-3"
            label={L("اضغط مطوّل للتصفير", "Hold to reset")}
            confirmLabel={L("اتصفّر", "Reset")}
            hint={L("اضغط مطوّل ثانيتين للتأكيد", "Press and hold for 2 seconds to confirm")}
            onConfirm={() => {
              resetBizDemo();
              setS(DEFAULT_TAX);
              notify({ title: L("بيانات الديمو رجعت للأول", "Demo data reset"), tone: "brass", icon: "check" });
            }}
          />
        </Card>
      </div>
      <aside className="sf-card h-max p-5 lg:sticky lg:top-24">
        <h3 className="font-sans text-[15px] font-semibold">{L("معاينة فاتورة", "Bill preview")}</h3>
        <div className="mt-3 grid gap-3">
          <Field label={L("سعر المنيو (ج.م)", "Menu price (EGP)")}>
            <input type="number" min={0} className="sf-input num" dir="ltr" value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Segmented size="sm" label={L("نوع الطلب", "Order type")} value={mode} onChange={setMode} options={[{ id: "dine-in", label: L("صالة", "Dine-in") }, { id: "takeaway", label: L("تيك أواي", "Takeaway") }, { id: "delivery", label: L("توصيل", "Delivery") }]} />
        </div>
        <dl className="mt-4 grid gap-1.5 text-[14px]">
          <div className="flex justify-between"><dt className="text-muted-foreground">{L("الأساس", "Base")}</dt><dd><Money v={p.base} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{L(`خدمة (${s.serviceCode})`, `Service (${s.serviceCode})`)}</dt><dd><Money v={p.service} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{L("ضريبة 14% (T1)", "VAT 14% (T1)")}</dt><dd><Money v={p.vat} /></dd></div>
          <div className="flex justify-between border-t pt-2 font-bold"><dt>{L("الضيف يدفع", "Guest pays")}</dt><dd><Money v={p.total} /></dd></div>
        </dl>
        <p className="mt-3 text-[12px] text-muted-foreground">{L("تقريب مبسّط للمعاينة. الفواتير الحقيقية بتتسعّر بالمحرك المالي بتقريب كل سطر لقرشين.", "Simplified preview. Real bills are priced by the finance core with per-line 2-decimal rounding.")}</p>
      </aside>
    </div>
  );
}

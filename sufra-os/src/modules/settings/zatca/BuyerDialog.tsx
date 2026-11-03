/**
 * KSA B2B buyer on a check → the sale is issued as a standard tax invoice (cleared by ZATCA before hand-over) instead of
 * a simplified one. Buyer VAT number (15 digits, 3…3) or another ID + national address (BR-KSA-10/14/63).
 */
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import type { Check } from "@/data/types";
import { useDb } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import type { ZatcaBuyer } from "@/lib/zatca/model";
import { checkAddress, isVatNumber } from "@/lib/zatca/validate";
import { Button, Dialog, Input } from "@/ui";

const EMPTY: ZatcaBuyer = { name: "", vatNumber: "", address: { street: "", building: "", district: "", city: "", postalCode: "", country: "SA" } };

export function BuyerDialog({ open, onClose, check }: { open: boolean; onClose: () => void; check: Check | null }) {
  const { L, lang } = useT();
  const db = useDb();
  const [b, setB] = useState<ZatcaBuyer>(EMPTY);
  useEffect(() => {
    if (open) setB({ ...EMPTY, ...(check?.taxBuyer ?? {}), address: { ...EMPTY.address, ...(check?.taxBuyer?.address ?? {}) } });
  }, [open, check?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const addr = (k: keyof NonNullable<ZatcaBuyer["address"]>, v: string) => setB((x) => ({ ...x, address: { ...x.address, [k]: v } }));
  const vatBad = !!b.vatNumber && !isVatNumber(b.vatNumber);
  const issues = checkAddress(b.address, "buyer");
  const ok = !!b.name.trim() && !!b.vatNumber && !vatBad && issues.length === 0;
  const save = async (buyer: ZatcaBuyer | null) => {
    if (!check) return;
    await db.update("checks", check.id, { taxBuyer: buyer });
    await db.audit("zatca.buyer", "checks", check.id, { vatNumber: buyer?.vatNumber ?? null });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={L("فاتورة ضريبية لشركة (B2B)", "Tax invoice for a company (B2B)")}
      description={L("بيانات المشتري بتحوّل الفاتورة من مبسطة لضريبية، وبتتعتمد من هيئة الزكاة قبل ما تتسلم.", "Buyer details turn the sale into a standard tax invoice, cleared by ZATCA before hand-over.")}
      footer={
        <>
          {check?.taxBuyer ? (
            <Button variant="ghost" onClick={() => void save(null)}>
              {L("رجّعها مبسطة", "Back to simplified")}
            </Button>
          ) : null}
          <Button icon={<Building2 className="size-4" />} disabled={!ok} onClick={() => void save({ ...b, name: b.name.trim() })}>
            {L("احفظ المشتري", "Save buyer")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={L("اسم المنشأة", "Company name")} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} wrapClassName="sm:col-span-2" />
        <Input label={L("الرقم الضريبي", "VAT number")} inputMode="numeric" dir="ltr" value={b.vatNumber ?? ""} onChange={(e) => setB({ ...b, vatNumber: e.target.value.replace(/\D/g, "").slice(0, 15) })} error={vatBad ? L("١٥ رقم يبدأ وينتهي بـ ٣", "15 digits, starts and ends with 3") : undefined} />
        <Input label={L("رقم المبنى", "Building no.")} inputMode="numeric" dir="ltr" value={b.address?.building ?? ""} onChange={(e) => addr("building", e.target.value.replace(/\D/g, "").slice(0, 4))} />
        <Input label={L("الشارع", "Street")} value={b.address?.street ?? ""} onChange={(e) => addr("street", e.target.value)} />
        <Input label={L("الحي", "District")} value={b.address?.district ?? ""} onChange={(e) => addr("district", e.target.value)} />
        <Input label={L("المدينة", "City")} value={b.address?.city ?? ""} onChange={(e) => addr("city", e.target.value)} />
        <Input label={L("الرمز البريدي", "Postal code")} inputMode="numeric" dir="ltr" value={b.address?.postalCode ?? ""} onChange={(e) => addr("postalCode", e.target.value.replace(/\D/g, "").slice(0, 5))} />
      </div>
      {issues.length && (b.address?.street || b.address?.building) ? <p className="mt-2 text-[12.5px] text-warn">{issues[0].message[lang]}</p> : null}
    </Dialog>
  );
}

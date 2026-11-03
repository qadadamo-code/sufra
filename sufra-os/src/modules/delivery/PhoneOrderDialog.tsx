/** Call-centre quick entry: phone → customer → address (pin on the map) → POS in delivery mode, prefilled. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bike, MapPin, Phone, ShoppingBag, UserRound } from "lucide-react";
import { useDb } from "@/data/hooks";
import type { Customer, DeliveryInfo, DeliveryZoneRow, LatLng } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { latinDigits } from "@/lib/arabic";
import { Badge, Button, Dialog, Input, Money, Segmented, Select, useToast } from "@/ui";
import { normalizePhone } from "@/modules/guest/api/service";
import { createPhoneOrder, findCustomer } from "./entry";
import { geometryCenter, zoneFor } from "./geo";
import { DeliveryMap } from "./map/DeliveryMap";

export function PhoneOrderDialog({ open, onClose, zones }: { open: boolean; onClose: () => void; zones: DeliveryZoneRow[] }) {
  const { L, loc } = useT();
  const db = useDb();
  const nav = useNavigate();
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [looked, setLooked] = useState(false);
  const [mode, setMode] = useState<"delivery" | "takeaway">("delivery");
  const [addr, setAddr] = useState<DeliveryInfo>({ address: "", area: "", notes: "", lat: null, lng: null });
  const [zoneSlug, setZoneSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const norm = normalizePhone(phone);

  useEffect(() => {
    if (!open) {
      setPhone("");
      setName("");
      setCustomer(null);
      setLooked(false);
      setAddr({ address: "", area: "", notes: "", lat: null, lng: null });
      setZoneSlug("");
    }
  }, [open]);

  useEffect(() => {
    if (!norm) {
      setLooked(false);
      setCustomer(null);
      return;
    }
    let off = false;
    void findCustomer(db, norm).then((c) => {
      if (off) return;
      setCustomer(c);
      setLooked(true);
      if (c) {
        setName(c.name);
        const a = c.addresses[0];
        if (a) pickAddress(a);
      }
    });
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [norm, db]);

  const active = zones.filter((z) => z.active);
  const zone = active.find((z) => z.slug === zoneSlug) ?? null;
  const pickAddress = (a: DeliveryInfo) => {
    setAddr(a);
    const p = a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null;
    const z = (p && zoneFor(p, active)) || active.find((x) => x.name.ar === a.area || x.name.en === a.area);
    if (z) setZoneSlug(z.slug);
  };
  const pick = (p: LatLng) => {
    const z = zoneFor(p, active);
    setAddr((a) => ({ ...a, lat: p.lat, lng: p.lng, area: z ? z.name.ar : a.area }));
    if (z) setZoneSlug(z.slug);
  };
  const shapes = useMemo(() => active.filter((z) => z.geometry).map((z) => ({ id: z.slug, geometry: z.geometry!, color: z.color, dim: z.slug !== zoneSlug, label: z.slug === zoneSlug ? loc(z.name) : undefined })), [active, zoneSlug, loc]);
  const pin = addr.lat != null && addr.lng != null ? [{ id: "door", kind: "door" as const, lat: addr.lat, lng: addr.lng, tone: "brass" as const }] : [];

  const ok = !!norm && !!name.trim() && (mode === "takeaway" || (!!addr.address.trim() && !!zone));
  const go = async () => {
    if (!ok || !norm) return;
    setBusy(true);
    try {
      const center = zone ? geometryCenter(zone.geometry) : null;
      const address: DeliveryInfo | null = mode === "delivery" ? { ...addr, area: zone ? zone.name.ar : addr.area, lat: addr.lat ?? center?.lat ?? null, lng: addr.lng ?? center?.lng ?? null } : null;
      const { checkId, order } = await createPhoneOrder(db, { mode, phone: norm, name, address, zone: zone ? { slug: zone.slug, fee: zone.fee } : null });
      toast({ title: L(`طلب #${order.number} اتفتح — كمّل الأصناف في الكاشير`, `Order #${order.number} opened — add items in the POS`), tone: "success" });
      onClose();
      nav(`/pos?check=${checkId}`);
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={L("طلب تليفون جديد", "New phone order")}
      description={L("ابحث برقم العميل، حدد العنوان، وكمّل الطلب في الكاشير", "Look up the caller, set the address, then finish in the POS")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {L("إلغاء", "Cancel")}
          </Button>
          <Button disabled={!ok} loading={busy} onClick={go} icon={mode === "delivery" ? <Bike /> : <ShoppingBag />}>
            {L("كمّل في الكاشير", "Continue in POS")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <Input label={L("رقم الموبايل", "Mobile")} icon={<Phone />} inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(latinDigits(e.target.value))} placeholder="01xxxxxxxxx" data-autofocus />
          {looked ? (
            customer ? (
              <div className="flex items-center gap-2 rounded-2xl bg-ok-soft px-3 py-2 text-[13.5px] text-ok">
                <UserRound className="size-4" /> {L(`عميل معروف · ${customer.visits} زيارة`, `Known customer · ${customer.visits} visits`)}
                {customer.tags.includes("vip") ? <Badge tone="brass" size="sm">VIP</Badge> : null}
              </div>
            ) : (
              <div className="rounded-2xl bg-surface-2 px-3 py-2 text-[13.5px] text-muted">{L("عميل جديد — هيتسجل مع الطلب", "New customer — saved with the order")}</div>
            )
          ) : null}
          <Input label={L("الاسم", "Name")} value={name} onChange={(e) => setName(e.target.value)} />
          <Segmented
            label={L("نوع الطلب", "Order type")}
            block
            value={mode}
            onChange={setMode}
            options={[
              { value: "delivery", label: L("توصيل", "Delivery"), icon: <Bike /> },
              { value: "takeaway", label: L("استلام من الفرع", "Pickup"), icon: <ShoppingBag /> },
            ]}
          />
          {mode === "delivery" ? (
            <>
              {customer?.addresses.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {customer.addresses.map((a, i) => (
                    <button key={i} type="button" onClick={() => pickAddress(a)} className={cn("max-w-full truncate rounded-full border px-3 py-1.5 text-[12.5px] font-semibold", addr.address === a.address ? "border-primary bg-primary-soft text-primary" : "border-line")}>
                      <MapPin className="me-1 inline size-3.5" />
                      {a.area} — {a.address}
                    </button>
                  ))}
                </div>
              ) : null}
              <Input label={L("العنوان", "Address")} value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} placeholder={L("الشارع، رقم العمارة، الدور، الشقة", "Street, building, floor, flat")} />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  label={L("المنطقة", "Zone")}
                  value={zoneSlug}
                  onChange={(e) => setZoneSlug(e.target.value)}
                  options={[{ value: "", label: L("اختار…", "Choose…") }, ...active.map((z) => ({ value: z.slug, label: loc(z.name) }))]}
                />
                <Input label={L("علامة مميزة", "Landmark / notes")} value={addr.notes} onChange={(e) => setAddr({ ...addr, notes: e.target.value })} />
              </div>
              {zone ? (
                <p className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
                  <span>
                    {L("التوصيل", "Delivery")} <Money value={zone.fee} compact className="font-bold text-ink" />
                  </span>
                  <span>
                    {L("أقل طلب", "Min.")} <Money value={zone.minOrder} compact />
                  </span>
                  <span className="num" dir="ltr">
                    {zone.etaMin}–{zone.etaMax}′
                  </span>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        {mode === "delivery" ? (
          <div className="grid content-start gap-1.5">
            <p className="text-[13px] font-semibold text-ink-2">{L("دبّوس العنوان (اضغط على الخريطة)", "Door pin (tap the map)")}</p>
            <DeliveryMap className="h-[300px] rounded-2xl border border-line md:h-[380px]" ariaLabel={L("اختار مكان العنوان", "Pick the address location")} shapes={shapes} pins={pin} onPick={pick} fitKey={zoneSlug} zoom={13} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

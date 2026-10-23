/** Customer by phone (find or create), delivery address + fee, pickup time. */
import { useEffect, useMemo, useState } from "react";
import { Bike, Clock, MapPin, Phone, UserPlus, UserRound } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { Customer, DeliveryInfo } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { latinDigits } from "@/lib/arabic";
import { cn } from "@/lib/cn";
import { formatMoney, major, type Units } from "@/lib/money";
import { Badge, Button, Dialog, Input } from "@/ui";

export interface CustomerResult {
  customer: Customer | null;
  delivery: DeliveryInfo | null;
  deliveryFee: Units;
  pickupAt: string | null;
}

export function CustomerDialog({ open, onClose, kind, initial, onDone }: {
  open: boolean;
  onClose: () => void;
  kind: "delivery" | "pickup" | "takeaway";
  initial: { customerId: string | null; delivery: DeliveryInfo | null; deliveryFee: Units; pickupAt: string | null };
  onDone: (r: CustomerResult) => void;
}) {
  const { L, lang } = useT();
  const db = useDb();
  const customers = useLive("customers").data;
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Customer | null>(null);
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [notes, setNotes] = useState("");
  const [fee, setFee] = useState("35");
  const [pickupIn, setPickupIn] = useState(20);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = customers.find((x) => x.id === initial.customerId) ?? null;
    setPicked(c);
    setPhone(c?.phone ?? "");
    setName(c?.name ?? "");
    setAddress(initial.delivery?.address ?? c?.addresses[0]?.address ?? "");
    setArea(initial.delivery?.area ?? c?.addresses[0]?.area ?? "");
    setNotes(initial.delivery?.notes ?? c?.addresses[0]?.notes ?? "");
    setFee(String((initial.deliveryFee || major(35)) / 100_000));
    setPickupIn(initial.pickupAt ? Math.max(5, Math.round((Date.parse(initial.pickupAt) - Date.now()) / 60_000)) : 20);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const digits = latinDigits(phone).replace(/\D/g, "");
  const matches = useMemo(() => (digits.length >= 3 ? customers.filter((c) => c.phone.includes(digits) || (name && c.name.includes(name))).slice(0, 5) : []), [customers, digits, name]);
  const exact = customers.find((c) => c.phone === digits) ?? null;

  const choose = (c: Customer) => {
    setPicked(c);
    setPhone(c.phone);
    setName(c.name);
    if (c.addresses[0]) {
      setAddress(c.addresses[0].address);
      setArea(c.addresses[0].area);
      setNotes(c.addresses[0].notes);
    }
  };

  const valid = kind !== "delivery" || (digits.length >= 10 && address.trim().length > 3);
  const done = async () => {
    setBusy(true);
    try {
      let c = picked ?? exact;
      const addr: DeliveryInfo | null = kind === "delivery" ? { address: address.trim(), area: area.trim(), notes: notes.trim(), lat: null, lng: null } : null;
      if (!c && digits.length >= 10) {
        c = await db.insert("customers", { phone: digits, name: name.trim(), email: null, visits: 0, lastVisitAt: null, totalSpent: 0, loyaltyPoints: 0, tags: kind === "delivery" ? ["delivery"] : [], notes: "", birthday: null, addresses: addr ? [addr] : [] });
      } else if (c && addr && !c.addresses.some((a) => a.address === addr.address)) {
        c = await db.update("customers", c.id, { addresses: [addr, ...c.addresses].slice(0, 5), ...(name.trim() && !c.name ? { name: name.trim() } : {}) });
      }
      onDone({ customer: c, delivery: addr, deliveryFee: kind === "delivery" ? major(Number(fee || 0)) : 0, pickupAt: kind === "pickup" ? new Date(Date.now() + pickupIn * 60_000).toISOString() : null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={kind === "delivery" ? L("طلب دليفري", "Delivery order") : kind === "pickup" ? L("استلام من الفرع", "Pickup order") : L("العميل", "Customer")}
      footer={
        <Button size="lg" disabled={!valid} loading={busy} onClick={done} data-autofocus={false}>
          {L("تمام", "Done")}
        </Button>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={L("الموبايل", "Mobile")} icon={<Phone />} value={phone} onChange={(e) => (setPhone(e.target.value), setPicked(null))} inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" autoFocus />
          <Input label={L("الاسم", "Name")} icon={<UserRound />} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {matches.length ? (
          <ul className="grid gap-1.5" aria-label={L("عملاء", "Customers")}>
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => choose(c)} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-start", picked?.id === c.id ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2")}>
                  <UserRound className="size-4 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{c.name || "—"}</span>
                    <span className="num block text-[12.5px] text-muted" dir="ltr">
                      {c.phone}
                    </span>
                  </span>
                  {c.tags.includes("vip") ? <Badge tone="brass" size="sm">VIP</Badge> : null}
                  <span className="text-[12px] text-muted">
                    {c.visits} {L("زيارة", "visits")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : digits.length >= 10 && !exact ? (
          <p className="flex items-center gap-2 text-[13.5px] text-muted">
            <UserPlus className="size-4" /> {L("عميل جديد — هيتسجل مع الطلب", "New customer — saved with the order")}
          </p>
        ) : null}
        {kind === "delivery" ? (
          <>
            <Input label={L("العنوان", "Address")} icon={<MapPin />} value={address} onChange={(e) => setAddress(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label={L("المنطقة", "Area")} value={area} onChange={(e) => setArea(e.target.value)} />
              <Input label={L("ملاحظات للطيار", "Driver notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <Input label={L("رسوم التوصيل", "Delivery fee")} icon={<Bike />} value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" hint={formatMoney(major(Number(fee || 0)), { lang })} />
            </div>
          </>
        ) : null}
        {kind === "pickup" ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
              <Clock className="size-4" /> {L("هيستلم بعد", "Ready in")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[10, 15, 20, 30, 45, 60, 90].map((m) => (
                <button key={m} type="button" onClick={() => setPickupIn(m)} aria-pressed={pickupIn === m} className={cn("num h-10 rounded-full border px-3.5 text-[14px] font-semibold", pickupIn === m ? "border-primary bg-primary text-primary-ink" : "border-line hover:bg-surface-2")}>
                  {m} {L("د", "min")}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

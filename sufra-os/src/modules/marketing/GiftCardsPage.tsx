import { useMemo, useState } from "react";
import { Gift, Plus, Search, Wallet } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { GiftCard } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, major, sumUnits } from "@/lib/money";
import { dayLabel } from "@/lib/time";
import { isExpired, liability, normalizeGiftCode } from "@/lib/promo";
import { Badge, Button, Dialog, EmptyState, Input, Money, Segmented, StatTile, Table, useToast, type Column } from "@/ui";
import { QrSvg } from "@/modules/guest/qr/QrSvg";
import { sellGiftCard } from "./ops";
import { MoneyInput } from "./ui";

export default function GiftCardsPage() {
  const { L, lang } = useT();
  const { can, restaurant } = useSession();
  const cards = useLive("giftCards", { orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const txns = useLive("giftCardTxns", { orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const [q, setQ] = useState("");
  const [sell, setSell] = useState(false);
  const [open, setOpen] = useState<GiftCard | null>(null);
  const now = new Date();
  const out = liability(cards);
  const sold30 = sumUnits(cards.filter((c) => Date.parse(c.createdAt) > now.getTime() - 30 * 86_400_000).map((c) => c.initial));
  const redeemed = sumUnits(txns.filter((t) => t.kind === "redeem").map((t) => t.amount));
  const breakage = sumUnits(cards.filter((c) => isExpired(c, now)).map((c) => c.balance));
  const rows = useMemo(() => cards.filter((c) => !q.trim() || normalizeGiftCode(q) === c.code || c.code.includes(q.toUpperCase()) || c.purchaser?.name.includes(q) || c.recipient?.name.includes(q)), [cards, q]);
  const cols: Column<GiftCard>[] = [
    { key: "code", header: L("الكود", "Code"), cell: (c) => <span className="num font-semibold" dir="ltr">{c.code}</span> },
    { key: "who", header: L("مين", "Who"), hideOnMobile: true, cell: (c) => <span className="text-[13px]">{c.purchaser?.name ?? "—"}{c.recipient ? ` → ${c.recipient.name}` : ""}</span> },
    { key: "via", header: L("اتباع", "Sold"), hideOnMobile: true, cell: (c) => <Badge size="sm">{c.soldVia === "online" ? L("أونلاين", "Online") : L("الكاشير", "POS")}</Badge> },
    { key: "init", header: L("القيمة", "Value"), align: "end", cell: (c) => <Money value={c.initial} compact /> },
    { key: "bal", header: L("الرصيد", "Balance"), align: "end", cell: (c) => <Money value={c.balance} className="font-semibold" /> },
    { key: "st", header: L("الحالة", "Status"), align: "end", cell: (c) => <Badge size="sm" tone={isExpired(c, now) ? "danger" : c.status === "active" ? "ok" : "neutral"}>{isExpired(c, now) ? L("منتهي", "expired") : c.status}</Badge> },
  ];
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} tone="brass" icon={<Wallet />} label={L("رصيد مستحق (التزام)", "Outstanding (liability)")} value={formatMoney(out, { lang, whole: true })} sub={L("حساب ٢٢٠٤ عرابين وكروت هدايا", "account 2204 deposits & gift cards")} />
        <StatTile index={1} icon={<Gift />} label={L("اتباع آخر ٣٠ يوم", "Sold (30 days)")} value={formatMoney(sold30, { lang, whole: true })} />
        <StatTile index={2} tone="ok" label={L("اتصرف", "Redeemed")} value={formatMoney(redeemed, { lang, whole: true })} />
        <StatTile index={3} tone="warn" label={L("منتهي ومش متصرف", "Expired unspent")} value={formatMoney(breakage, { lang, whole: true })} sub={L("إيراد (breakage) عند الانتهاء", "breakage income on expiry")} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Input wrapClassName="min-w-60 flex-1" icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("كود الكارت أو الاسم", "Card code or name")} aria-label={L("بحث", "Search")} />
        {can("marketing.manage") || can("payments.take") ? (
          <Button icon={<Plus className="size-4" />} onClick={() => setSell(true)}>
            {L("بيع كارت", "Sell a card")}
          </Button>
        ) : null}
        <a className="inline-flex h-11 items-center rounded-xl border border-line px-4 font-semibold hover:bg-surface-2" href={`${import.meta.env.BASE_URL}r/${restaurant?.slug ?? ""}/gift`} target="_blank" rel="noreferrer">
          {L("صفحة الشراء أونلاين ↗", "Online purchase page ↗")}
        </a>
      </div>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table columns={cols} rows={rows} rowKey={(c) => c.id} onRowClick={setOpen} caption={L("كروت الهدايا", "Gift cards")} empty={<EmptyState compact icon={<Gift />} title={L("مفيش كروت", "No gift cards")} />} />
      </div>
      <SellGiftCardDialog open={sell} onClose={() => setSell(false)} />
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.code} description={open ? `${formatMoney(open.balance, { lang })} / ${formatMoney(open.initial, { lang })}` : ""}>
        {open ? (
          <div className="grid gap-3 pb-1">
            <div className="grid place-items-center rounded-2xl bg-white p-3">
              <QrSvg value={open.code} fg="#000" className="size-36" />
            </div>
            <p className="text-[13px] text-muted">{L("بينتهي", "Expires")} {open.expiresAt ? dayLabel(open.expiresAt, lang) : "—"}</p>
            <ul className="grid gap-1 text-[13.5px]">
              {txns.filter((t) => t.giftCardId === open.id).map((t) => (
                <li key={t.id} className="flex justify-between rounded-xl bg-surface-2 px-3 py-1.5">
                  <span>{t.kind} · {dayLabel(t.createdAt, lang)}</span>
                  <Money value={t.kind === "redeem" ? -t.amount : t.amount} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export function SellGiftCardDialog({ open, onClose, onSold }: { open: boolean; onClose: () => void; onSold?: (c: GiftCard) => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [amount, setAmount] = useState(major(500));
  const [method, setMethod] = useState<"cash" | "card" | "wallet">("cash");
  const [buyer, setBuyer] = useState({ name: "", phone: "" });
  const [to, setTo] = useState({ name: "", phone: "", message: "" });
  const [done, setDone] = useState<GiftCard | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setDone(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={done ? L("الكارت جاهز", "Card ready") : L("بيع كارت هدية", "Sell a gift card")} footer={done ? <Button block onClick={close}>{L("تمام", "Done")}</Button> : <Button block size="lg" loading={busy} disabled={amount <= 0} onClick={async () => {
      setBusy(true);
      try {
        const c = await sellGiftCard(db, { amount, purchaser: buyer.name || buyer.phone ? buyer : null, recipient: to.name ? to : null, via: "pos", method });
        setDone(c);
        onSold?.(c);
        toast({ title: L("اتباع كارت هدية", "Gift card sold"), description: c.code, tone: "success" });
      } finally {
        setBusy(false);
      }
    }}>{L("خد", "Take")} {formatMoney(amount, { lang })}</Button>}>
      {done ? (
        <div className="grid place-items-center gap-3 pb-1 text-center">
          <div className="w-full max-w-xs rounded-[22px] bg-[linear-gradient(135deg,var(--sf-primary),color-mix(in_srgb,var(--sf-brass)_70%,black))] p-5 text-white shadow-sf-lg">
            <p className="text-[13px] opacity-80">{L("كارت هدية", "Gift card")}</p>
            <p className="mt-2 font-display text-[30px] font-semibold"><Money value={done.initial} /></p>
            <p className="num mt-3 text-[17px] tracking-wider" dir="ltr">{done.code}</p>
          </div>
          <div className="rounded-2xl bg-white p-2"><QrSvg value={done.code} fg="#000" className="size-32" /></div>
          <p className="text-[13px] text-muted">{L("اطبعه أو ابعته للمستلم على واتساب", "Print it or send it to the recipient on WhatsApp")}</p>
        </div>
      ) : (
        <div className="grid gap-4 pb-1">
          <div className="flex flex-wrap gap-2">
            {[250, 500, 1000, 2000].map((v) => (
              <button key={v} type="button" onClick={() => setAmount(major(v))} className={`num h-11 rounded-xl border px-4 font-semibold ${amount === major(v) ? "border-primary bg-primary text-primary-ink" : "border-line hover:bg-surface-2"}`}>{v}</button>
            ))}
          </div>
          <MoneyInput label={L("القيمة", "Amount")} value={amount} onChange={setAmount} />
          <Segmented block label={L("الدفع", "Paid by")} value={method} onChange={setMethod} options={[{ value: "cash", label: L("كاش", "Cash") }, { value: "card", label: L("فيزا", "Card") }, { value: "wallet", label: L("محفظة", "Wallet") }]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={L("اسم المشتري", "Buyer name")} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
            <Input label={L("موبايل المشتري", "Buyer mobile")} dir="ltr" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} />
            <Input label={L("اسم المستلم (اختياري)", "Recipient (optional)")} value={to.name} onChange={(e) => setTo({ ...to, name: e.target.value })} />
            <Input label={L("رسالة", "Message")} value={to.message} onChange={(e) => setTo({ ...to, message: e.target.value })} />
          </div>
          <p className="text-[12.5px] text-muted">{L("بيع كارت الهدية مش مبيعات (مافيهوش ضريبة) — بيتسجل التزام لحد ما يتصرف.", "A gift card sale is not revenue (no VAT) — it is a liability until it is spent.")}</p>
        </div>
      )}
    </Dialog>
  );
}

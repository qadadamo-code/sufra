/** Rider ↔ dispatch push-to-talk card for the rider app (src/modules/delivery/DriverApp.tsx). */
import { Link } from "react-router-dom";
import { RadioTower } from "lucide-react";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { Badge } from "@/ui";
import { radio, useRadioEngine } from "./engine";
import { PttButton, usePttNotices } from "./PttButton";
import { recorderSupported } from "./recorder";
import { useUnread } from "./useClips";

export function DriverRadio() {
  const { L } = useT();
  const { can, staff } = useSession();
  const snap = useRadioEngine();
  const unread = useUnread();
  usePttNotices();
  if (!can("radio.use") || !staff) return null;
  const onAir = snap.onAir.find((a) => a.channel === "delivery" && a.who !== staff.id);
  return (
    <section className="flex items-center gap-4 rounded-[24px] border border-line bg-surface p-3 shadow-sf-sm" data-driver-radio>
      {recorderSupported() ? <PttButton channel="delivery" size="md" label={L("اضغط وكلّم الديسباتش", "Hold to talk to dispatch")} /> : null}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-bold">
          <RadioTower className="size-4 text-primary" /> {L("كلّم الديسباتش", "Talk to dispatch")}
          {unread.delivery ? <Badge size="sm" tone="danger">{unread.delivery}</Badge> : null}
        </p>
        <p className="text-[12.5px] text-muted">{onAir ? L(`${onAir.name} بيتكلم…`, `${onAir.name} is talking…`) : L("اضغط مطوّل واتكلم — الرسايل بتشتغل لوحدها", "Hold and talk — replies play automatically")}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" className="rounded-full bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold" onClick={() => void radio.sendText("delivery", L("وصلت للعميل", "Arrived at the customer"))}>{L("وصلت", "Arrived")}</button>
          <button type="button" className="rounded-full bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold" onClick={() => void radio.sendText("delivery", L("العميل مش بيرد", "Customer not answering"))}>{L("العميل مش بيرد", "No answer")}</button>
          <Link to="/radio?ch=delivery" className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-primary">{L("كل الرسايل", "All messages")}</Link>
        </div>
      </div>
    </section>
  );
}

import { useState } from "react";
import { Download, MoreVertical, PlusSquare, Share } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { useInstall } from "@/lib/pwa";
import { Button, Dialog, IconButton } from "@/ui";

/** "Install the app" — native prompt where the browser offers one, step-by-step guide on iPhone/iPad and elsewhere. */
export function InstallApp({ variant = "icon" }: { variant?: "icon" | "button" }) {
  const { L } = useT();
  const { mode, install } = useInstall();
  const [open, setOpen] = useState(false);
  if (mode === "installed") return null;
  const onClick = async () => {
    if (mode === "prompt" && (await install())) return;
    setOpen(true);
  };
  const label = L("ثبّت التطبيق", "Install app");
  return (
    <>
      {variant === "icon" ? (
        <IconButton label={label} onClick={onClick}>
          <Download />
        </IconButton>
      ) : (
        <Button variant="soft" icon={<Download className="size-4" />} onClick={onClick}>
          {label}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={L("ثبّت سُفرة على جهازك", "Install Sufra on your device")}
        description={L("هيفتح زي أي تطبيق: أيقونة على الشاشة، شاشة كاملة من غير شريط المتصفح.", "It opens like any app: an icon on your home screen, full screen without the browser bar.")}
        footer={<Button onClick={() => setOpen(false)}>{L("تمام", "Got it")}</Button>}
      >
        <div className="flex items-center gap-4 rounded-2xl bg-surface-2 p-4">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="size-14 rounded-[14px] shadow-sf-sm" />
          <div>
            <p className="font-display text-[18px] font-bold">سُفرة</p>
            <p className="text-[13px] text-muted">{L("نظام المطعم", "Restaurant system")}</p>
          </div>
        </div>
        {mode === "ios" ? (
          <ol className="mt-4 grid gap-3 text-[15px]">
            <Step n={1} icon={<Share className="size-5" />}>{L("افتح الرابط في Safari واضغط زر المشاركة تحت", "Open the link in Safari and tap the Share button")}</Step>
            <Step n={2} icon={<PlusSquare className="size-5" />}>{L("اختار «إضافة إلى الشاشة الرئيسية»", "Choose “Add to Home Screen”")}</Step>
            <Step n={3} icon={<Download className="size-5" />}>{L("اضغط «إضافة» — هتلاقي أيقونة سُفرة على الشاشة", "Tap “Add” — the Sufra icon appears on your home screen")}</Step>
          </ol>
        ) : (
          <ol className="mt-4 grid gap-3 text-[15px]">
            <Step n={1} icon={<MoreVertical className="size-5" />}>{L("افتح قائمة المتصفح (⋮) أو أيقونة التثبيت جنب الرابط", "Open the browser menu (⋮) or the install icon next to the address bar")}</Step>
            <Step n={2} icon={<Download className="size-5" />}>{L("اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»", "Choose “Install app” or “Add to Home screen”")}</Step>
          </ol>
        )}
      </Dialog>
    </>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line p-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-mono text-[14px] text-primary-ink">{n}</span>
      <span className="flex-1">{children}</span>
      <span className="text-primary">{icon}</span>
    </li>
  );
}

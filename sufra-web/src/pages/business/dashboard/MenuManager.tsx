import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { load, save } from "@/lib/storage";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Photo } from "@/components/sufra/Photo";
import { ReorderList } from "@/components/business/ReorderList";
import { Money, Pill } from "@/components/business/kit";
import { MENU, type MenuSectionDemo } from "@/data/business/demo";

const KEY = "sufra.biz.menu.v1";

export default function MenuManager() {
  const { L, lang } = useLang();
  const [sections, setSections] = useState<MenuSectionDemo[]>(() => {
    const saved = load<{ order: string[]; off: string[] } | null>(KEY, null);
    if (!saved) return MENU;
    const byId = Object.fromEntries(MENU.map((s) => [s.id, s]));
    const ordered = saved.order.map((id) => byId[id]).filter(Boolean);
    const rest = MENU.filter((s) => !saved.order.includes(s.id));
    return [...ordered, ...rest].map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, available: saved.off.includes(i.id) ? false : i.available })) }));
  });
  const [open, setOpen] = useState<string | null>("grills");
  const persist = (next: MenuSectionDemo[]) => save(KEY, { order: next.map((s) => s.id), off: next.flatMap((s) => s.items.filter((i) => !i.available).map((i) => i.id)) });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <p className="mb-3 text-[13.5px] text-muted-foreground">{L("رتّب أقسام المنيو بالسحب من المقبض (أو Space ثم الأسهم). الترتيب ده هو اللي بيظهر في منيو الـ QR والتطبيق والكاشير.", "Reorder menu sections with the grip (or Space then arrows). This order is what guests see on the QR menu, the app and the POS.")}</p>
        <ReorderList
          items={sections}
          getId={(s) => s.id}
          getLabel={(s) => (lang === "ar" ? s.ar : s.en)}
          onReorder={setSections}
          onCommit={(next) => {
            persist(next);
          }}
          label={L("أقسام المنيو", "Menu sections")}
          messages={
            lang === "ar"
              ? {
                  grabbed: (l, p, t) => `مسكت ${l}، المكان ${p} من ${t}.`,
                  moved: (l, p, t) => `${l}، المكان ${p} من ${t}.`,
                  dropped: (l, p) => `سبت ${l} في المكان ${p}.`,
                  cancelled: (l) => `اتلغى. ${l} رجع مكانه.`,
                  hint: "اضغط Space عشان تمسك، الأسهم للتحريك، Space للتثبيت، Escape للإلغاء.",
                }
              : undefined
          }
        >
          {(s) => (
            <div>
              <button type="button" className="flex w-full items-center justify-between gap-2 text-start" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span className="font-semibold">{lang === "ar" ? s.ar : s.en}</span>
                <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="num">{s.items.length}</span> {L("أصناف", "items")}
                  <ChevronDown className={cn("size-4 transition-transform", open === s.id && "rotate-180")} aria-hidden />
                </span>
              </button>
              {open === s.id ? (
                <ul className="mt-2 grid gap-1.5">
                  {s.items.map((it) => {
                    const fc = Math.round((it.cost / it.price) * 1000) / 10;
                    return (
                      <li key={it.id} className="flex items-center gap-2.5 rounded-lg bg-surface-2 p-1.5">
                        <Photo k={it.img} label={lang === "ar" ? it.ar : it.en} className="size-10 shrink-0 rounded-lg" />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-[14px] font-medium", !it.available && "text-muted-foreground line-through")}>{lang === "ar" ? it.ar : it.en}</span>
                          <span className="text-[12px] text-muted-foreground"><Money v={it.price} /> · {L("تكلفة", "cost")} <span className={cn("num", fc > 35 ? "text-warn" : "text-ok")}>{fc}%</span></span>
                        </span>
                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px]">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--sf-primary)]"
                            checked={it.available}
                            onChange={(e) => {
                              const next = sections.map((x) => (x.id === s.id ? { ...x, items: x.items.map((i) => (i.id === it.id ? { ...i, available: e.target.checked } : i)) } : x));
                              setSections(next);
                              persist(next);
                              notify({ title: e.target.checked ? L("رجع للمنيو", "Back on the menu") : L("اتخفى من المنيو (خلص)", "Hidden (86'd)"), detail: lang === "ar" ? it.ar : it.en, ttl: 2400 });
                            }}
                          />
                          {L("متاح", "On")}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          )}
        </ReorderList>
      </div>
      <aside className="sf-card h-max p-4">
        <h3 className="font-sans text-[15px] font-semibold">{L("معاينة منيو الـ QR", "QR menu preview")}</h3>
        <ol className="mt-3 grid gap-2">
          {sections.map((s, i) => (
            <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
              <span><span className="num text-brass">{i + 1}</span> {lang === "ar" ? s.ar : s.en}</span>
              {s.items.some((x) => !x.available) ? <Pill tone="warn">{s.items.filter((x) => !x.available).length} {L("مخفي", "hidden")}</Pill> : null}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

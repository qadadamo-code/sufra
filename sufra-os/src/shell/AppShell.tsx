import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useSession } from "@/auth/session";
import { can } from "@/auth/permissions";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { loadRaw, saveRaw } from "@/lib/storage";
import { modules } from "@/modules/registry";
import { Skeleton, useCommands, useHotkeys, useReduced, useToast } from "@/ui";
import { Languages, Lock, Moon } from "lucide-react";
import { useTheme } from "@/theme/theme";
import { BottomNav } from "./BottomNav";
import { ErrorBoundary } from "./ErrorBoundary";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar } from "./Sidebar";
import { TopBar, useShellTitle } from "./TopBar";

const COLLAPSE_KEY = "sufra-os.sidebar";

export function PageFallback() {
  return (
    <div className="grid gap-4" aria-busy>
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32" rounded="rounded-[20px]" />
        ))}
      </div>
      <Skeleton className="h-72" rounded="rounded-[20px]" />
    </div>
  );
}

/** Locks a PIN session after the restaurant's idle timeout. */
function useAutoLock() {
  const s = useSession();
  const { t } = useT();
  const { toast } = useToast();
  const settings = useLive("settings").data[0];
  const minutes = settings?.autoLockMinutes ?? 0;
  useEffect(() => {
    if (s.method !== "pin" || !minutes) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        s.lock();
        toast({ title: t("toast.locked") });
      }, minutes * 60_000);
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [s.method, minutes]); // eslint-disable-line react-hooks/exhaustive-deps
}

function ShellCommands() {
  const { role, lock, deviceRestaurantId } = useSession();
  const nav = useNavigate();
  const { toggleLang } = useT();
  const theme = useTheme();
  const visible = modules.filter((m) => m.nav && (!m.permission || can(role, m.permission)));
  useCommands(
    [
      ...visible.map((m) => {
        const Icon = m.icon;
        return { id: `go.${m.id}`, group: "screens", title: m.title, subtitle: m.description, icon: <Icon />, shortcut: m.shortcut, keywords: m.keywords, perform: () => nav(m.nav!.path) };
      }),
      { id: "lang", group: "actions", title: { ar: "English", en: "عربي" }, keywords: ["language", "لغة"], icon: <Languages />, perform: toggleLang },
      { id: "theme", group: "actions", title: { ar: "غيّر المظهر (فاتح/غامق)", en: "Toggle light/dark" }, keywords: ["theme", "dark"], icon: <Moon />, perform: theme.toggle },
      ...(deviceRestaurantId ? [{ id: "lock", group: "actions", title: { ar: "اقفل الشاشة", en: "Lock screen" }, icon: <Lock />, perform: lock }] : []),
    ],
    [role, theme.dark, deviceRestaurantId],
  );
  // module shortcuts ("g p" …)
  const keys: Record<string, () => void> = {};
  for (const m of visible) if (m.shortcut) keys[m.shortcut] = () => nav(m.nav!.path);
  useHotkeys(keys);
  return null;
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => loadRaw(COLLAPSE_KEY) === "1");
  const [help, setHelp] = useState(false);
  const { lang } = useT();
  const loc = useLocation();
  const reduced = useReduced();
  const title = useShellTitle();
  useAutoLock();
  const toggle = () =>
    setCollapsed((v) => {
      saveRaw(COLLAPSE_KEY, v ? "0" : "1");
      return !v;
    });
  useHotkeys({ "[": toggle, "?": () => setHelp(true) });
  useEffect(() => {
    document.title = title ? `${title} · ${lang === "ar" ? "سُفرة" : "Sufra"}` : lang === "ar" ? "سُفرة" : "Sufra";
  }, [title, lang]);

  return (
    <div className="flex min-h-dvh bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:shadow-sf">
        {lang === "ar" ? "تخطّى للمحتوى" : "Skip to content"}
      </a>
      <ShellCommands />
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <main id="main" tabIndex={-1} className="flex-1 px-4 pt-5 pb-28 outline-none md:px-6 md:pt-6 md:pb-10 xl:px-8">
          {/* keyed entrance only: an exit animation would re-render the NEW route inside the old wrapper */}
          <motion.div key={loc.pathname.split("/")[1]} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
              <ErrorBoundary lang={lang} resetKey={loc.pathname}>
                <Suspense fallback={<PageFallback />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
          </motion.div>
        </main>
      </div>
      <BottomNav />
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

/** Signed-in, chrome-less (kitchen display / kiosk POS). */
export function BareLayout() {
  const { lang } = useT();
  const loc = useLocation();
  return (
    <div className="min-h-dvh bg-bg">
      <ShellCommands />
      <ErrorBoundary lang={lang} resetKey={loc.pathname}>
        <Suspense fallback={<div className="p-6"><PageFallback /></div>}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

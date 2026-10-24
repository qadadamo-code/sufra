import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Languages, Moon, Sun } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { useTheme } from "@/theme/theme";
import { IconButton, useReduced } from "@/ui";
import { InstallApp } from "@/shell/InstallApp";

export function AuthToggles() {
  const { t, toggleLang } = useT();
  const theme = useTheme();
  return (
    <div className="flex items-center gap-1">
      <InstallApp />
      <IconButton label={t("shell.langLabel")} onClick={toggleLang}>
        <Languages />
      </IconButton>
      <IconButton label={t("shell.theme")} onClick={theme.toggle}>
        {theme.dark ? <Sun /> : <Moon />}
      </IconButton>
    </div>
  );
}

/** Eight-point star lattice (khatam) drawn as a repeating SVG pattern; drifts slowly. */
export function StarPattern({ className, opacity = 0.14 }: { className?: string; opacity?: number }) {
  const reduced = useReduced();
  return (
    <motion.svg
      className={className}
      aria-hidden
      initial={false}
      animate={reduced ? undefined : { x: [0, -48], y: [0, -48] }}
      transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      style={{ width: "calc(100% + 96px)", height: "calc(100% + 96px)" }}
    >
      <defs>
        <pattern id="khatam" width="48" height="48" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1" opacity={opacity}>
            <rect x="12" y="12" width="24" height="24" />
            <rect x="12" y="12" width="24" height="24" transform="rotate(45 24 24)" />
            <circle cx="24" cy="24" r="4" />
            <path d="M0 24h7M41 24h7M24 0v7M24 41v7" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#khatam)" />
    </motion.svg>
  );
}

export function GlowOrbs() {
  return (
    <>
      <div className="pointer-events-none absolute -top-40 -start-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgb(61_179_163/0.35),transparent_65%)]" aria-hidden />
      <div className="pointer-events-none absolute -bottom-48 -end-32 size-[560px] rounded-full bg-[radial-gradient(circle,rgb(226_169_60/0.28),transparent_65%)]" aria-hidden />
    </>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-[440px]">{children}</div>;
}

/**
 * Small owner/admin editor for a numeric settings block (service-call SLA seconds, KDS aging minutes).
 * Writes `settings.<key>`; RLS limits settings updates to owner/admin, so the editor only shows for them.
 */
import { useEffect, useState } from "react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { Settings } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { Button, Input, useToast } from "@/ui";

type NumKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

export function useCanEditSettings() {
  const { role } = useSession();
  return role === "owner" || role === "admin";
}

export function ThresholdsEditor<K extends "serviceCalls" | "kitchen">({
  settingsKey,
  value,
  fields,
  title,
}: {
  settingsKey: K;
  value: NonNullable<Settings[K]>;
  fields: { key: NumKeys<NonNullable<Settings[K]>> & string; label: string; unit: string }[];
  title: string;
}) {
  const db = useDb();
  const { t } = useT();
  const { toast } = useToast();
  const settings = useLive("settings").data[0];
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setDraft(Object.fromEntries(fields.map((f) => [f.key, String((value as Record<string, number>)[f.key])]))), [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!settings) return null;
  const save = async () => {
    const next = { ...(value as object) } as Record<string, number | boolean>;
    for (const f of fields) {
      const n = Number(draft[f.key]);
      if (Number.isFinite(n) && n > 0) next[f.key] = Math.round(n);
    }
    await db.update("settings", settings.id, { [settingsKey]: next } as Partial<Settings>);
    toast({ title: t("toast.saved"), tone: "success" });
  };
  return (
    <form
      className="grid gap-2 rounded-[18px] border border-line bg-surface p-4 shadow-sf-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-[14.5px] font-bold">{title}</p>
      <div className="grid grid-cols-3 gap-2">
        {fields.map((f) => (
          <Input
            key={f.key}
            label={f.label}
            inputMode="numeric"
            value={draft[f.key] ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value.replace(/[^\d]/g, "") }))}
            end={<span className="pe-2 text-[12px] text-muted">{f.unit}</span>}
          />
        ))}
      </div>
      <Button type="submit" size="sm" variant="secondary" className="justify-self-end">
        {t("common.save")}
      </Button>
    </form>
  );
}

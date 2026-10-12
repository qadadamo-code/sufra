/** UserTable — rebuilt from the owner's spec (blobatar faces) in Sufra tokens. Used for staff and supplier customers. */
import type { ReactNode } from "react";
import { Blobatar } from "@blobatar/react";
import { cn } from "@/lib/utils";

export interface UserRow {
  id: string;
  name: string;
  email?: string;
  role: string;
  status: { label: string; tone: "ok" | "warn" | "muted" | "danger" | "primary" };
  lastSeen: string;
  extra?: ReactNode;
}

const TONES = {
  ok: "border-ok/40 text-ok",
  warn: "border-warn/40 text-warn",
  muted: "border-border text-muted-foreground",
  danger: "border-danger/40 text-danger",
  primary: "border-primary/40 text-primary",
};

export function UserTable({ users, caption, headers, className, extraHeader }: { users: UserRow[]; caption: string; headers: { user: string; role: string; status: string; lastSeen: string }; className?: string; extraHeader?: string }) {
  return (
    <div className={cn("relative overflow-x-auto rounded-xl border bg-card", className)}>
      <table className="w-full min-w-[34rem] text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-[12px] text-muted-foreground">
            <th scope="col" className="px-4 py-3 text-start font-semibold">{headers.user}</th>
            <th scope="col" className="px-4 py-3 text-start font-semibold">{headers.role}</th>
            <th scope="col" className="px-4 py-3 text-start font-semibold">{headers.status}</th>
            {extraHeader ? <th scope="col" className="px-4 py-3 text-end font-semibold">{extraHeader}</th> : null}
            <th scope="col" className="px-4 py-3 text-end font-semibold">{headers.lastSeen}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b transition-colors last:border-0 hover:bg-accent/60">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <Blobatar name={u.id} background="squircle" className="size-8 shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{u.name}</p>
                    {u.email ? <p className="truncate text-[12px] text-muted-foreground" dir="ltr">{u.email}</p> : null}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{u.role}</td>
              <td className="px-4 py-2.5">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold", TONES[u.status.tone])}>
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />
                  {u.status.label}
                </span>
              </td>
              {extraHeader ? <td className="px-4 py-2.5 text-end">{u.extra}</td> : null}
              <td className="num px-4 py-2.5 text-end text-[12px] text-muted-foreground">{u.lastSeen}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default UserTable;

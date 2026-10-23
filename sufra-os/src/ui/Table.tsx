import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./Skeleton";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "start" | "end" | "center";
  width?: string;
  /** hide below md */
  hideOnMobile?: boolean;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, onRowClick, empty, loading, dense, className, caption, selectedKey }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  empty?: ReactNode;
  loading?: boolean;
  dense?: boolean;
  className?: string;
  caption?: string;
  selectedKey?: string | null;
}) {
  const al = (a?: Column<T>["align"]) => (a === "end" ? "text-end" : a === "center" ? "text-center" : "text-start");
  return (
    <div className={cn("overflow-x-auto thin-scrollbar", className)}>
      <table className="w-full border-separate border-spacing-0 text-[14px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ width: c.width }}
                className={cn("sticky top-0 z-[1] border-b border-line bg-surface-2/90 px-4 py-2.5 text-[12px] font-semibold whitespace-nowrap text-muted backdrop-blur", al(c.align), c.hideOnMobile && "max-md:hidden")}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 4 }, (_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn("border-b border-line px-4 py-3", c.hideOnMobile && "max-md:hidden")}>
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((r) => {
                const k = rowKey(r);
                return (
                  <tr
                    key={k}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(r)) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-selected={selectedKey ? selectedKey === k : undefined}
                    className={cn("group transition-colors", onRowClick && "cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", selectedKey === k && "bg-primary-soft/60")}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cn("border-b border-line px-4", dense ? "py-2" : "py-3", al(c.align), c.hideOnMobile && "max-md:hidden", c.className)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {!loading && !rows.length ? empty : null}
    </div>
  );
}

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "soft" | "brass" | "danger" | "danger-soft";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_6px_16px_-8px_var(--sf-primary)] hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line shadow-sf-sm hover:border-line-strong hover:bg-surface-2",
  outline: "border border-line-strong text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-3 hover:text-ink",
  soft: "bg-primary-soft text-primary hover:bg-[color-mix(in_srgb,var(--sf-primary-soft)_80%,var(--sf-primary))]",
  brass: "bg-brass text-brass-ink shadow-[0_6px_16px_-8px_var(--sf-brass)] hover:brightness-[1.06]",
  danger: "bg-danger text-white hover:brightness-110",
  "danger-soft": "bg-danger-soft text-danger hover:brightness-[0.97]",
};
// sm is for dense desktop toolbars; md+ meet the 44px touch target.
const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13.5px] gap-1.5 rounded-[10px]",
  md: "h-11 px-4.5 text-[15px] gap-2 rounded-xl",
  lg: "h-13 px-6 text-[16px] gap-2.5 rounded-2xl",
  xl: "h-16 px-8 text-[18px] gap-3 rounded-[20px]",
};

export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) =>
  cn(
    "relative inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-[background-color,color,border-color,box-shadow,transform,filter] duration-150 ease-[var(--ease-sf)]",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2",
    VARIANT[variant],
    SIZE[size],
    extra,
  );

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "md", loading, icon, iconEnd, block, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, cn(block && "w-full", className))} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon}
      {children}
      {iconEnd}
    </button>
  );
});

export function LinkButton({ variant = "primary", size = "md", icon, iconEnd, className, children, ...rest }: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode; iconEnd?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
      {iconEnd}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** accessible name (also the tooltip) */
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  badge?: ReactNode;
}

const ICON_SIZE = { sm: "size-9 rounded-[10px]", md: "size-11 rounded-xl", lg: "size-14 rounded-2xl" };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, variant = "ghost", size = "md", badge, className, children, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(buttonClass(variant, "md"), "px-0", ICON_SIZE[size], "[&_svg]:size-[20px]", size === "lg" && "[&_svg]:size-6", className)}
      {...rest}
    >
      {children}
      {badge != null && badge !== false ? (
        <span className="pointer-events-none absolute -top-0.5 -end-0.5 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-bold leading-[18px] text-white ring-2 ring-[var(--sf-surface)]">{badge}</span>
      ) : null}
    </button>
  );
});

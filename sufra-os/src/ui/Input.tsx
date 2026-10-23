import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

const FIELD =
  "w-full rounded-xl border border-line bg-surface text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 outline-none " +
  "hover:border-line-strong focus:border-primary focus:shadow-[var(--sf-glow)] disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--sf-danger)_18%,transparent)]";

export function Field({ label, hint, error, children, className, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-2">
          {label}
        </label>
      ) : null}
      {children}
      {error ? <p className="text-[12.5px] font-medium text-danger">{error}</p> : hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  icon?: ReactNode;
  end?: ReactNode;
  size?: "md" | "lg";
  wrapClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, icon, end, size = "md", className, wrapClassName, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid} className={wrapClassName}>
      <div className="relative">
        {icon ? <span className="pointer-events-none absolute inset-y-0 start-3.5 grid place-items-center text-muted [&_svg]:size-[18px]">{icon}</span> : null}
        <input
          ref={ref}
          id={fid}
          aria-invalid={error ? true : undefined}
          className={cn(FIELD, size === "lg" ? "h-13 text-[16px]" : "h-11 text-[15px]", icon ? "ps-11" : "ps-3.5", end ? "pe-12" : "pe-3.5", className)}
          {...rest}
        />
        {end ? <span className="absolute inset-y-0 end-1 grid place-items-center">{end}</span> : null}
      </div>
    </Field>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: ReactNode }>(function Textarea({ label, hint, error, className, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <textarea ref={ref} id={fid} aria-invalid={error ? true : undefined} className={cn(FIELD, "min-h-24 resize-y px-3.5 py-2.5 text-[15px]", className)} {...rest} />
    </Field>
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: { value: string; label: string; disabled?: boolean }[];
  size?: "md" | "lg";
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, options, size = "md", className, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid}>
      <div className="relative">
        <select ref={ref} id={fid} aria-invalid={error ? true : undefined} className={cn(FIELD, "appearance-none ps-3.5 pe-10", size === "lg" ? "h-13 text-[16px]" : "h-11 text-[15px]", className)} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </Field>
  );
});

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-4", disabled && "cursor-not-allowed opacity-60")}>
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        {description ? <span className="block text-[13px] text-muted">{description}</span> : null}
      </span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" />
        <span className="absolute top-1 size-5 rounded-full bg-white shadow-sf-sm transition-[inset-inline-start] duration-200 ease-[var(--ease-sf)] [inset-inline-start:4px] peer-checked:[inset-inline-start:24px]" />
      </span>
    </label>
  );
}

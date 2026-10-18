"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ---------------------------------------------------------------- Buttons

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "soft" | "danger" | "whatsapp" | "default";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  icon?: string;
};

export function Button({ variant = "default", size = "md", block, loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cx("btn", variant !== "default" && variant, size !== "md" && size, block && "block", className)}
      disabled={disabled || loading}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="spinner" aria-hidden />}
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, size, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; size?: "sm" }) {
  return (
    <button type="button" className={cx("icon-btn", size, className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size === "sm" ? 18 : 20} />
    </button>
  );
}

// ---------------------------------------------------------------- Fields

export function Field({ label, hint, error, optional, children, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string; optional?: boolean; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label} {optional && <span className="opt">(לא חובה)</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          <Icon name="alert" size={13} /> {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}

export function TextField({ label, hint, error, optional, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string; optional?: boolean }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} optional={optional} htmlFor={rest.id ?? id}>
      <input id={rest.id ?? id} className={cx("input", className)} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function TextArea({ label, hint, error, optional, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string; optional?: boolean }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} optional={optional} htmlFor={rest.id ?? id}>
      <textarea id={rest.id ?? id} className={cx("textarea", className)} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  optional,
  options,
  className,
  placeholder,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string; optional?: boolean; options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} optional={optional} htmlFor={rest.id ?? id}>
      <select id={rest.id ?? id} className={cx("select", className)} aria-invalid={error ? true : undefined} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SearchInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input
        className="input"
        type="search"
        inputMode="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder ?? "חיפוש"}
        autoFocus={autoFocus}
      />
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function RadioCards<T extends string>({ value, onChange, options, columns }: { value: T | null; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: ReactNode; icon?: string }[]; columns?: 1 | 2 }) {
  return (
    <div role="radiogroup" className={columns === 2 ? "outcome-grid" : "radio-cards"}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="radio-card" onClick={() => onChange(o.value)}>
          <span className="radio-dot" />
          {o.icon && <Icon name={o.icon} size={18} />}
          <span className="grow">
            <span className="bold">{o.label}</span>
            {o.hint && <span className="xsmall muted" style={{ display: "block" }}>{o.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Segmented & Tabs

function useThumb(ref: React.RefObject<HTMLElement | null>, selector: string, deps: unknown[]) {
  const [style, setStyle] = useState<{ insetInlineStart: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>(selector);
      if (!active) return setStyle(null);
      const parentRect = el.getBoundingClientRect();
      const r = active.getBoundingClientRect();
      const rtl = getComputedStyle(el).direction === "rtl";
      setStyle({ insetInlineStart: rtl ? parentRect.right - r.right + el.scrollLeft * -1 : r.left - parentRect.left + el.scrollLeft, width: r.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return style;
}

export function Segmented<T extends string>({ value, onChange, options, block, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; block?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useThumb(ref, 'button[aria-pressed="true"]', [value, options.length]);
  return (
    <div ref={ref} className={cx("segmented", block && "block")} role="group" aria-label={label}>
      {thumb && <span className="thumb" style={thumb} aria-hidden />}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="seg-count num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[]; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const ink = useThumb(ref, 'button[aria-selected="true"]', [value, tabs.length]);
  return (
    <div ref={ref} className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
      {ink && <span className="tab-ink" style={ink} aria-hidden />}
    </div>
  );
}

// ---------------------------------------------------------------- Display

export function Badge({ tone, children, dot, title }: { tone?: "green" | "orange" | "red" | "blue" | "purple" | "accent" | "gray"; children: ReactNode; dot?: boolean; title?: string }) {
  return (
    <span className={cx("badge", tone && tone !== "gray" && tone)} title={title}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

const AVATAR_COLORS = ["#23735f", "#17304d", "#8a5a2b", "#5b4b9a", "#2f6f9f", "#9a3f5b", "#4f7a2e", "#7a5c00"];

export function Avatar({ name, size }: { name: string; size?: "sm" | "lg" }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={cx("avatar", size)} style={{ background: AVATAR_COLORS[h % AVATAR_COLORS.length] }} aria-hidden>
      {initials || "?"}
    </span>
  );
}

export function EmptyState({ icon = "inbox", title, text, action }: { icon?: string; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty fade-in">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", radius }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden />;
}

export function Banner({ tone = "info", icon, children, action }: { tone?: "info" | "warn" | "danger" | "ok"; icon?: string; children: ReactNode; action?: ReactNode }) {
  const defaultIcon = tone === "warn" ? "alert" : tone === "danger" ? "alert" : tone === "ok" ? "checkCircle" : "info";
  return (
    <div className={cx("banner", tone !== "info" && tone)} role={tone === "danger" || tone === "warn" ? "alert" : "status"}>
      <Icon name={icon ?? defaultIcon} size={18} />
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function SuccessCheck({ size = 76 }: { size?: number }) {
  return (
    <div className="success-burst" style={{ width: size, height: size }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m5 12 5 5L20 7" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- Overlays

/** False during SSR and the first client render, so portals never cause hydration mismatches. */
function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}

function useClosing(open: boolean, duration = 200) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, duration);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { mounted, closing };
}

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter(
        (n) => n.offsetParent !== null,
      );
    const t = setTimeout(() => {
      const auto = el?.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
      (auto ?? el)?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  headerExtra?: ReactNode;
}) {
  const { mounted, closing } = useClosing(open, 220);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, onClose);
  // Swipe-down to dismiss on touch devices.
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const hydrated = useHydrated();
  if (!mounted || !hydrated) return null;
  return createPortal(
    <>
      <div className="overlay" data-closing={closing || undefined} onClick={onClose} />
      <div
        ref={ref}
        className={cx("sheet", wide && "wide")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-closing={closing || undefined}
        onTouchStart={(e) => {
          const body = ref.current?.querySelector(".sheet-body");
          if (body && body.scrollTop > 0) return;
          drag.current = { y: e.touches[0].clientY, dy: 0 };
        }}
        onTouchMove={(e) => {
          if (!drag.current || !ref.current || window.innerWidth >= 768) return;
          const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
          drag.current.dy = dy;
          ref.current.style.transform = `translateY(${dy}px)`;
          ref.current.style.transition = "none";
        }}
        onTouchEnd={() => {
          if (!drag.current || !ref.current) return;
          const dy = drag.current.dy;
          ref.current.style.transition = "";
          ref.current.style.transform = "";
          drag.current = null;
          if (dy > 110) onClose();
        }}
      >
        <div className="sheet-head">
          <div className="grow">
            <h2 className="sheet-title" id={titleId}>
              {title}
            </h2>
            {subtitle && <div className="small muted">{subtitle}</div>}
          </div>
          {headerExtra}
          <IconButton icon="close" label="סגירה" onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, onClose);
  const hydrated = useHydrated();
  if (!open || !hydrated) return null;
  return createPortal(
    <>
      <div className="overlay dialog-overlay" onClick={onClose} />
      <div ref={ref} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">{actions}</div>
      </div>
    </>,
    document.body,
  );
}

type ConfirmOpts = { title: string; body?: ReactNode; confirm?: string; cancel?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        actions={
          <>
            <Button onClick={() => close(false)}>{state?.cancel ?? "ביטול"}</Button>
            <Button variant={state?.danger ? "danger" : "primary"} onClick={() => close(true)} data-autofocus>
              {state?.confirm ?? "אישור"}
            </Button>
          </>
        }
      >
        {state?.body}
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

// ---------------------------------------------------------------- Toasts

type Toast = { id: number; text: string; tone: "success" | "error" | "info"; action?: { label: string; onClick: () => void }; closing?: boolean };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"], action?: Toast["action"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: Toast["tone"] = "success", action?: Toast["action"]) => {
    const tid = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id: tid, text, tone, action }]);
    const ttl = tone === "error" ? 5200 : 3200;
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === tid ? { ...x, closing: true } : x))), ttl);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== tid)), ttl + 220);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={cx("toast", t.tone)} data-closing={t.closing || undefined} role={t.tone === "error" ? "alert" : "status"}>
            <Icon className="toast-icon" name={t.tone === "error" ? "alert" : t.tone === "success" ? "checkCircle" : "info"} size={19} />
            <span>{t.text}</span>
            {t.action && <button onClick={t.action.onClick}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- Menu

export function Menu({ trigger, children, up }: { trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; children: ReactNode; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div className={cx("menu", up && "up")} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Hooks

/** Wraps an async action with loading state and error toasts. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string; onError?: (e: unknown) => boolean | void } = {}) {
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setLoading(true);
      try {
        const r = await fn(...args);
        if (opts.success) toast(opts.success, "success");
        return r;
      } catch (e) {
        if (!opts.onError?.(e)) toast((e as Error).message || "משהו השתבש", "error");
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );
  return { run, loading };
}

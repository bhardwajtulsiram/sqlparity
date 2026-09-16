'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DIALECTS } from '@/lib/dialects';

/* ------------------------------------------------------------------- panel */

export function Panel({
  title,
  description,
  step,
  actions,
  children,
  tone = 'default',
  className = '',
}: {
  title?: string;
  description?: string;
  /** Shows a numbered badge, giving stacked panels an obvious reading order. */
  step?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** 'primary' marks the panel holding the result — the payoff, not another input. */
  tone?: 'default' | 'primary';
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border ${
        tone === 'primary' ? 'border-accent-500/40' : 'border-[var(--border-card)]'
      } bg-[var(--surface-card)] shadow-[var(--shadow-card)] ${className}`}
    >
      {(title || actions) && (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-card)] px-5 py-3.5 ${
            tone === 'primary' ? 'bg-accent-500/12' : 'bg-[var(--surface-header)]'
          }`}
        >
          {step !== undefined && (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">
              {step}
            </span>
          )}
          <div className="min-w-0">
            {title && <h2 className="text-[15px] leading-tight font-semibold">{title}</h2>}
            {description && (
              <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">{description}</p>
            )}
          </div>
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------- disclosure */

/**
 * Collapsed by default. Anything a first-time user does not need in order to get a
 * useful result belongs in here — the tool should look simple until you want more.
 */
export function Disclosure({
  label,
  hint,
  children,
  defaultOpen = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-card)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-[var(--surface-header)] px-4 py-2.5 text-left text-sm font-medium hover:brightness-[0.97]"
      >
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`size-3 shrink-0 fill-none stroke-current stroke-2 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        >
          <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
        {hint && !open && (
          <span className="truncate text-xs font-normal text-ink-500 dark:text-ink-400">
            — {hint}
          </span>
        )}
      </button>
      {open && <div className="border-t border-[var(--border-card)] p-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ toggle */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-px h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent-600' : 'bg-ink-300 dark:bg-ink-700'
        }`}
      >
        <span
          className={`block size-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm leading-5 select-none">
        {label}
        {hint && (
          <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">{hint}</span>
        )}
      </label>
    </div>
  );
}

/* ------------------------------------------------------- segmented control */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; title?: string }[];
  label?: string;
}) {
  return (
    <div>
      {label && (
        <span className="mb-2 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
          {label}
        </span>
      )}
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex rounded-lg bg-ink-100 p-0.5 dark:bg-ink-800"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              value === option.value
                ? 'bg-[var(--surface-card)] text-accent-700 shadow-sm dark:text-accent-400'
                : 'text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ fields */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-medium text-ink-700 dark:text-ink-300">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-500 dark:text-ink-400">{hint}</span>}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25';

export function Select({
  value,
  onChange,
  children,
  disabled,
  title,
}: {
  value: string;
  onChange: (next: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <select
      className={`${CONTROL} disabled:cursor-not-allowed disabled:opacity-50`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      title={title}
    >
      {children}
    </select>
  );
}

export function DialectSelect({
  value,
  onChange,
  label = 'SQL dialect',
  disabled,
  title,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  /** Greyed rather than hidden, so it is clear the control exists but does not apply. */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Field label={label}>
      <Select value={value} onChange={onChange} disabled={disabled} title={title}>
        {DIALECTS.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max = 100000,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      className={CONTROL}
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        onChange(Number.isNaN(n) ? 0 : Math.min(max, Math.max(min, n)));
      }}
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      className={`${CONTROL} ${mono ? 'font-mono' : ''}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A large paste target. The main input on two of the three tools. */
export function PasteArea({
  value,
  onChange,
  rows = 14,
  placeholder,
  readOnly = false,
  minHeight,
}: {
  value: string;
  onChange?: (next: string) => void;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
  /** Viewport-relative height so the box fills a tall screen instead of stopping short. */
  minHeight?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      readOnly={readOnly}
      spellCheck={false}
      rows={rows}
      placeholder={placeholder}
      style={minHeight ? { minHeight } : undefined}
      className={`w-full resize-y rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] p-3.5 font-mono text-[13px] leading-relaxed outline-none ${
        readOnly ? '' : 'focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25'
      }`}
    />
  );
}

/* -------------------------------------------------------------- columnbox */

/**
 * One list in a set of positionally-paired lists.
 *
 * The three of these line up row by row, so the thing a person most needs to know is
 * what happens when one is left empty. That answer lives in `count`, which says
 * "Same names as the left" rather than "0 lines" — a number would be accurate and
 * useless. An optional box that is empty is drawn with a dashed edge and a recessive
 * field; filling it makes the edge solid, so being in use is visible rather than
 * stated.
 */
export function ColumnBox({
  label,
  help,
  value,
  onChange,
  count,
  optional = false,
  disabled = false,
  disabledNote,
  mismatch,
  blanks = 0,
  onRemoveBlanks,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (next: string) => void;
  /** What this box currently contributes — including when it is empty. */
  count: string;
  optional?: boolean;
  disabled?: boolean;
  disabledNote?: string;
  /** Set when this list's length disagrees with the one it pairs against. */
  mismatch?: string;
  /** Blank lines still count as rows, so they are the usual reason two lists that
   *  look identical do not line up. Naming them is what makes that fixable. */
  blanks?: number;
  onRemoveBlanks?: () => void;
}) {
  const id = useId();
  const inUse = value.trim() !== '';
  const dashed = optional && !inUse && !disabled;

  return (
    <div className={disabled ? 'opacity-55' : undefined}>
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <p className="mt-0.5 mb-2 text-xs text-ink-500 dark:text-ink-400">
        {disabled ? (disabledNote ?? help) : help}
      </p>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        rows={10}
        className={`w-full resize-y rounded-lg p-3 font-mono text-[13px] leading-relaxed outline-none disabled:cursor-not-allowed ${
          dashed
            ? 'border border-dashed border-[var(--border-card)] bg-[var(--surface-sunken)]'
            : 'border border-[var(--border-card)] bg-[var(--surface-sunken)]'
        } ${disabled ? '' : 'focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25'}`}
      />
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span
          className={
            mismatch
              ? 'font-medium text-amber-700 dark:text-amber-400'
              : 'text-ink-500 dark:text-ink-400'
          }
        >
          {mismatch ?? count}
        </span>
        {blanks > 0 && (
          <>
            <span className="text-ink-500 dark:text-ink-400">
              {blanks} blank line{blanks === 1 ? '' : 's'} included
            </span>
            {onRemoveBlanks && (
              <button
                type="button"
                onClick={onRemoveBlanks}
                className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-600 dark:text-accent-400"
              >
                Remove them
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ buttons */

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  title?: string;
}) {
  const base =
    'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const styles = {
    primary: 'bg-accent-600 text-white hover:bg-accent-700',
    secondary:
      'border border-[var(--border-card)] text-ink-700 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
    ghost: 'text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800',
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${styles}`}
    >
      {children}
    </button>
  );
}

/**
 * Put text on the clipboard, and report honestly whether it worked.
 *
 * The async Clipboard API is blocked outside a secure context and by some managed
 * browser profiles. The old execCommand path still works in several of those, so it is
 * worth trying before giving up — and when both fail the button says so rather than
 * looking like it did nothing, which is indistinguishable from being broken.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label = 'Copy',
  variant = 'secondary',
}: {
  text: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(() => {
    if (!text) return;
    void writeClipboard(text).then((ok) => {
      setState(ok ? 'copied' : 'failed');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), ok ? 1600 : 2600);
    });
  }, [text]);

  return (
    <Button
      onClick={copy}
      variant={variant}
      disabled={!text}
      title={state === 'failed' ? 'Your browser blocked clipboard access' : undefined}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Press Ctrl+C' : label}
    </Button>
  );
}

/* ---------------------------------------------------------------- messages */

export function Note({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success';
  children: React.ReactNode;
}) {
  const styles = {
    info: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
    warn: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    error: 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200',
    success: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  }[tone];
  return <div className={`rounded-lg px-3.5 py-2.5 text-[13px] ${styles}`}>{children}</div>;
}

export function WarningList({
  warnings,
}: {
  warnings: { level: 'warn' | 'info'; message: string }[];
}) {
  if (warnings.length === 0) return null;
  return (
    <ul className="mt-4 space-y-2">
      {warnings.map((w, i) => (
        <li key={i}>
          <Note tone={w.level === 'warn' ? 'warn' : 'info'}>{w.message}</Note>
        </li>
      ))}
    </ul>
  );
}

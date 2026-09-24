'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DIALECTS } from '@/lib/dialects';
import {
  AlertIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronIcon,
  CopyIcon,
  ErrorIcon,
  InfoIcon,
} from '@/components/icons';

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
  const primary = tone === 'primary';
  return (
    <section
      className={`relative overflow-hidden rounded-xl border bg-[var(--surface-card)] shadow-[var(--shadow-card)] ${
        primary ? 'border-accent-500/45' : 'border-[var(--border-card)]'
      } ${className}`}
    >
      {/* The result panel carries a lit top edge, so the eye lands on the payoff first. */}
      {primary && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-accent-500 via-accent-400 to-[var(--signal)]"
        />
      )}
      {(title || actions) && (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3 ${
            primary
              ? 'border-accent-500/20 bg-gradient-to-b from-accent-500/[0.07] to-transparent'
              : 'border-[var(--border-card)] bg-[var(--surface-header)]'
          }`}
        >
          {step !== undefined && (
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11.5px] font-semibold ${
                primary
                  ? 'bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-[0_1px_2px_oklch(0.3_0.1_250/0.4),inset_0_1px_0_rgb(255_255_255/0.2)]'
                  : 'bg-[var(--surface-card)] text-ink-600 ring-1 ring-[var(--border-strong)] dark:text-ink-300'
              }`}
            >
              {step}
            </span>
          )}
          <div className="min-w-0 py-0.5">
            {title && <h2 className="text-[14.5px] leading-tight font-semibold">{title}</h2>}
            {description && (
              <p className="mt-1 text-[12.5px] leading-snug text-ink-500 dark:text-ink-400">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
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
    <div className="overflow-hidden rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[var(--shadow-control)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-[var(--surface-header)]"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-card)] bg-[var(--surface-header)] text-ink-500 group-hover:text-ink-800 dark:text-ink-400 dark:group-hover:text-ink-100">
          <ChevronIcon
            className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </span>
        {label}
        {hint && !open && (
          <span className="truncate text-[12.5px] font-normal text-ink-500 dark:text-ink-400">
            {hint}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-fade border-t border-[var(--border-card)] p-5">{children}</div>
      )}
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
        className={`mt-px h-5 w-9 shrink-0 rounded-full shadow-[inset_0_1px_2px_oklch(0.2_0.02_265/0.2)] transition-colors duration-200 ${
          checked ? 'bg-accent-600' : 'bg-ink-300 dark:bg-ink-700'
        }`}
      >
        <span
          className={`block size-4 rounded-full bg-white shadow-[0_1px_2px_oklch(0.2_0.02_265/0.35)] transition-transform duration-200 ${
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
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-600 dark:text-ink-300">
          {label}
        </span>
      )}
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex h-9 items-stretch rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] p-[3px]"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-all ${
              value === option.value
                ? 'bg-[var(--surface-card)] text-accent-700 shadow-[0_1px_2px_oklch(0.2_0.02_265/0.12),0_0_0_1px_oklch(0.2_0.02_265/0.06)] dark:bg-ink-700 dark:text-white'
                : 'text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100'
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
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-600 dark:text-ink-300">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-500 dark:text-ink-400">{hint}</span>}
    </label>
  );
}

const CONTROL =
  'h-9 w-full rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-3 text-sm shadow-[var(--shadow-control)] outline-none transition-[border-color,box-shadow] placeholder:text-ink-400 hover:border-[var(--border-strong)] focus:border-accent-500 focus:ring-3 focus:ring-accent-500/20';

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
    <div className="relative">
      <select
        className={`${CONTROL} cursor-pointer appearance-none truncate pr-9 disabled:cursor-not-allowed disabled:opacity-50`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title={title}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-400" />
    </div>
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
      className={`${CONTROL} font-mono tabular-nums`}
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
      className={`${CONTROL} ${mono ? 'font-mono text-[13px]' : ''}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const WELL =
  'shadow-[inset_0_1px_2px_oklch(0.2_0.02_265/0.05)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-ink-400';
const WELL_FOCUS =
  'focus:border-accent-500 focus:bg-[var(--surface-card)] focus:ring-3 focus:ring-accent-500/20';

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
      className={`w-full resize-y rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] p-3.5 font-mono text-[13px] leading-relaxed ${WELL} ${
        readOnly ? '' : WELL_FOCUS
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
        className={`w-full resize-y rounded-lg p-3 font-mono text-[13px] leading-relaxed disabled:cursor-not-allowed ${
          dashed
            ? 'border border-dashed border-[var(--border-strong)] bg-[var(--surface-sunken)]'
            : 'border border-[var(--border-card)] bg-[var(--surface-sunken)]'
        } ${WELL} ${disabled ? '' : WELL_FOCUS}`}
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
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  title?: string;
  /** A leading glyph from components/icons; the button sizes it. */
  icon?: React.ReactNode;
}) {
  const base =
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-all active:translate-y-px disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0';
  const styles = {
    primary:
      'bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_oklch(0.3_0.12_250/0.45),0_0_0_1px_oklch(0.46_0.16_250)] hover:from-accent-600 hover:to-accent-700',
    secondary:
      'border border-[var(--border-card)] bg-[var(--surface-card)] text-ink-700 shadow-[var(--shadow-control)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-header)] dark:text-ink-200',
    ghost:
      'text-ink-600 hover:bg-ink-900/[0.055] hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/[0.07] dark:hover:text-ink-100',
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${styles}`}
    >
      {icon}
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
      icon={state === 'copied' ? <CheckIcon /> : state === 'failed' ? <AlertIcon /> : <CopyIcon />}
    >
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Press Ctrl+C' : label}
      </span>
    </Button>
  );
}

/* ---------------------------------------------------------------- messages */

const NOTE_ICON = {
  info: InfoIcon,
  warn: AlertIcon,
  error: ErrorIcon,
  success: CheckCircleIcon,
};

export function Note({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success';
  children: React.ReactNode;
}) {
  const styles = {
    info: 'border-[var(--border-card)] bg-[var(--surface-header)] text-ink-600 dark:text-ink-300 [&>svg]:text-ink-400',
    warn: 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
    error:
      'border-red-300/70 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200 [&>svg]:text-red-600 dark:[&>svg]:text-red-400',
    success:
      'border-emerald-300/70 bg-emerald-50 text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400',
  }[tone];
  const Icon = NOTE_ICON[tone];
  return (
    <div
      className={`flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed ${styles}`}
    >
      <Icon className="mt-[3px] size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
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

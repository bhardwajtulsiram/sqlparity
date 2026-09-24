import { getTool } from '@/components/tools';

/**
 * The top of every tool page: what the tool is, then the few choices that change what
 * it produces.
 *
 * The title sits on the page rather than in a box, so it reads as the page's heading
 * instead of as one more panel; the controls sit in a toolbar card directly beneath,
 * where they are clearly settings for everything below. The icon tile is cut from the
 * same dark code surface as the editors, so the tool is introduced by its material.
 */
export function ToolHeader({
  href,
  description,
  status,
  children,
  footer,
}: {
  /** The tool's route, which names and draws it via components/tools. */
  href: string;
  description: React.ReactNode;
  /** Right of the title: a live state or the page's main action. */
  status?: React.ReactNode;
  /** The controls toolbar. Omit for a tool with nothing to choose up front. */
  children?: React.ReactNode;
  /** Below the controls, inside the toolbar: an explanation of the current choice. */
  footer?: React.ReactNode;
}) {
  const tool = getTool(href);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="relative flex size-12 shrink-0 items-center justify-center rounded-xl border shadow-[0_6px_16px_-6px_oklch(0.2_0.05_265/0.5),inset_0_1px_0_rgb(255_255_255/0.08)]"
            style={{
              background:
                'linear-gradient(145deg, oklch(0.29 0.03 265), var(--code-surface) 70%)',
              borderColor: 'var(--code-border)',
              color: 'var(--syn-string)',
            }}
          >
            <tool.Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-[28px]">
              {tool.name}
            </h1>
            <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-ink-600 dark:text-ink-400">
              {description}
            </p>
          </div>
        </div>
        {status && <div className="ml-auto flex flex-wrap items-center gap-3">{status}</div>}
      </div>

      {(children || footer) && (
        <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[var(--shadow-card)]">
          {children && (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-5 py-4">{children}</div>
          )}
          {footer && (
            <div
              className={`rounded-b-xl bg-[var(--surface-header)] px-5 py-3 ${
                children ? 'border-t border-[var(--border-card)]' : 'rounded-t-xl'
              }`}
            >
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

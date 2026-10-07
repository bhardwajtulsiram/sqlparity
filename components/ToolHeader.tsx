import Link from 'next/link';
import { ChevronIcon } from '@/components/icons';
import { getGroup, getTool, toolsIn } from '@/components/tools';

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
  const group = getGroup(tool.group);
  const siblings = toolsIn(tool.group).filter((t) => t.href !== tool.href);

  return (
    <div className="space-y-5">
      {/* Where this tool sits, and the others that do the same kind of job. With the
          tools in one header menu, this is the quick way between related ones. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-ink-500 dark:text-ink-400">
            <li>
              <Link href="/#tools" className="hover:text-ink-900 dark:hover:text-ink-100">
                Tools
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronIcon className="size-3 text-ink-300 dark:text-ink-600" />
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 rounded-[2px]" style={{ background: group.color }} />
              {group.name}
            </li>
            <li aria-hidden="true">
              <ChevronIcon className="size-3 text-ink-300 dark:text-ink-600" />
            </li>
            <li aria-current="page" className="font-medium text-ink-800 dark:text-ink-200">
              {tool.name}
            </li>
          </ol>
        </nav>
        {siblings.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="text-ink-400 dark:text-ink-500">Also for this job</span>
            {siblings.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-card)] bg-[var(--surface-card)] px-2.5 font-medium text-ink-600 shadow-[var(--shadow-control)] transition-colors hover:border-[var(--border-strong)] hover:text-ink-900 dark:text-ink-300 dark:hover:text-white"
              >
                <s.Icon className="size-3.5" />
                {s.name}
              </Link>
            ))}
          </div>
        )}
      </div>

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

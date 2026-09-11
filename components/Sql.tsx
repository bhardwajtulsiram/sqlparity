import { getDialect } from '@/lib/dialects';
import { highlightSql, type TokenKind } from '@/lib/highlight';

const COLOR: Record<TokenKind, string> = {
  keyword: 'var(--syn-keyword)',
  function: 'var(--syn-function)',
  string: 'var(--syn-string)',
  comment: 'var(--syn-comment)',
  identifier: 'var(--syn-identifier)',
  number: 'var(--syn-number)',
  operator: 'var(--syn-operator)',
  plain: 'var(--syn-plain)',
};

/**
 * Syntax-lit SQL, on the dark code surface.
 *
 * No hooks and no client boundary: highlighting is a pure function of the text, so
 * every static snippet on the marketing page is coloured at build time and ships as
 * plain markup.
 */
export function Sql({
  code,
  dialectId = 'trino',
  className = '',
}: {
  code: string;
  dialectId?: string;
  className?: string;
}) {
  const tokens = highlightSql(code, getDialect(dialectId));

  return (
    <code
      className={`block font-mono whitespace-pre-wrap ${className}`}
      style={{ color: 'var(--syn-plain)' }}
    >
      {tokens.map((token, i) => (
        <span key={i} style={{ color: COLOR[token.kind] }}>
          {token.text}
        </span>
      ))}
    </code>
  );
}

/**
 * The dark panel SQL sits in. Separated from Sql so a panel can hold a caption or a
 * before/after pair without nesting two code elements.
 */
export function CodeSurface({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border ${className}`}
      style={{
        background: 'var(--code-surface)',
        borderColor: 'var(--code-border)',
      }}
    >
      {children}
    </div>
  );
}

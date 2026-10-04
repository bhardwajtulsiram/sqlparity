'use client';

import { useState } from 'react';
import { buildShareUrl } from '@/lib/share';

interface ShareButtonProps<T> {
  getState: () => T;
  label?: string;
  className?: string;
}

export function ShareButton<T>({
  getState,
  label = 'Share Link',
  className = '',
}: ShareButtonProps<T>) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    try {
      const state = getState();
      const url = buildShareUrl(state);
      if (!url) return;

      // Update URL hash without causing navigation or page reload
      if (typeof window !== 'undefined') {
        const hash = url.slice(url.indexOf('#'));
        window.history.replaceState(null, '', hash);
      }

      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard fallback if blocked
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      title="Copy private share link (encoded in URL hash, 0 data sent to servers)"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-accent-500 hover:text-ink-900 dark:text-ink-200 dark:hover:text-white transition-all shadow-xs ${className}`}
    >
      {copied ? (
        <>
          <svg className="size-3.5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-accent-600 dark:text-accent-400 font-semibold">Link Copied!</span>
        </>
      ) : (
        <>
          <svg className="size-3.5 text-ink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

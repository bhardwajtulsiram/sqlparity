import React from 'react';

export interface StepGuide {
  step: number;
  title: string;
  description: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ToolFaqSectionProps {
  toolName: string;
  tagline: string;
  steps: StepGuide[];
  faqs: FaqItem[];
}

export function ToolFaqSection({ toolName, tagline, steps, faqs }: ToolFaqSectionProps) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };

  return (
    <section className="mt-16 border-t border-[var(--border-card)] pt-12 space-y-12">
      {/* Schema.org FAQPage JSON-LD for Search Engines */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Quickstart Guide */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            How to Use {toolName}
          </h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400 leading-relaxed">
            {tagline}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.step}
              className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-card)] flex flex-col"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-[0_1px_2px_oklch(0.3_0.1_250/0.4)]">
                  {s.step}
                </span>
                <h3 className="text-sm font-semibold text-ink-900 dark:text-white tracking-tight">
                  {s.title}
                </h3>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-600 dark:text-ink-400">
                {s.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ Section */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            Frequently Asked Questions
          </h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400 leading-relaxed">
            Common questions about privacy, supported dialects, and how {toolName} works under the hood.
          </p>
        </div>

        <div className="divide-y divide-[var(--border-card)] rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[var(--shadow-card)] overflow-hidden">
          {faqs.map((faq, idx) => (
            <details
              key={idx}
              className="group p-5 cursor-pointer transition-colors hover:bg-[var(--surface-sunken)] [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex items-center justify-between gap-4 font-medium text-sm text-ink-900 dark:text-white select-none">
                <span>{faq.question}</span>
                <span className="shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-xs leading-relaxed text-ink-600 dark:text-ink-400 pr-6">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

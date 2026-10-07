import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, DIRECTIVES } from '../lib/csp';

/**
 * The policy is sent three ways — meta tag, vercel.json, public/_headers — and shown
 * on two pages. One drifting from the others would make the Security page describe a
 * policy that is not the one in force, so the copies are checked against lib/csp.ts.
 */
describe('Content Security Policy', () => {
  const header = contentSecurityPolicy({ header: true });

  it('is the header vercel.json sends', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const sent = vercel.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy');
    expect(sent.value).toBe(header);
  });

  it('is the header public/_headers declares', () => {
    expect(readFileSync('public/_headers', 'utf8')).toContain(`Content-Security-Policy: ${header}`);
  });

  it('forbids requests to any other origin, and frames only in the header form', () => {
    expect(header).toContain("connect-src 'self'");
    expect(header).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy()).not.toContain('frame-ancestors');
  });

  it('allows eval only in development', () => {
    expect(contentSecurityPolicy()).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ dev: true })).toContain("'unsafe-eval'");
    expect(DIRECTIVES.every((d) => d.why.length > 0)).toBe(true);
  });
});

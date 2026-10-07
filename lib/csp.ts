/**
 * The Content Security Policy, in one place.
 *
 * The product's claim is that nothing you paste leaves the tab. That is true because
 * of how the code is written — but "true because I wrote it carefully" is a weaker
 * guarantee than "the browser will not permit otherwise". `connect-src 'self'` is the
 * directive that matters: it forbids the page from opening a request to any other
 * origin, so a dependency that turned malicious in some future update still could not
 * send a schema anywhere.
 *
 * The same policy reaches the browser three ways, and all three read it from here:
 * the <meta> tag in app/layout.tsx (any host), the response header in vercel.json
 * (Vercel, which also carries frame-ancestors — a meta tag cannot) and public/_headers
 * (Netlify, Cloudflare Pages). The home page prints it from here too, so the policy
 * shown to a reader is the policy in force. tests/csp.test.ts fails if
 * vercel.json or public/_headers drift from it.
 */

export interface Directive {
  name: string;
  value: string;
  /** What it does, for the Security page. */
  why: string;
}

export const DIRECTIVES: Directive[] = [
  { name: 'default-src', value: "'self'", why: 'Anything not listed below may only come from this site.' },
  {
    name: 'script-src',
    value: "'self' 'wasm-unsafe-eval' 'unsafe-inline'",
    why: "Scripts come from this site only. 'wasm-unsafe-eval' lets the database engines compile their WebAssembly; it does not allow JavaScript eval. 'unsafe-inline' is needed because a static export cannot mint a per-request nonce; nothing in the app renders user input as markup.",
  },
  { name: 'style-src', value: "'self' 'unsafe-inline'", why: 'Styles come from this site.' },
  { name: 'img-src', value: "'self' data:", why: 'Images come from this site, or are drawn in the page.' },
  { name: 'font-src', value: "'self'", why: 'Fonts are served by this site, not a font CDN.' },
  {
    name: 'connect-src',
    value: "'self'",
    why: 'The one that enforces the promise: the page may not open a request to any other server.',
  },
  { name: 'worker-src', value: "'self' blob:", why: 'Background workers (the file engine runs in one) come from this site.' },
  { name: 'object-src', value: "'none'", why: 'No plugins or embedded objects.' },
  { name: 'base-uri', value: "'self'", why: 'Relative links cannot be redirected to another site.' },
  { name: 'form-action', value: "'none'", why: 'No form on the site can submit anywhere.' },
];

/**
 * Only expressible as a response header; browsers ignore it in a <meta> tag.
 */
export const FRAME_ANCESTORS: Directive = {
  name: 'frame-ancestors',
  value: "'none'",
  why: 'No other site may embed this one in a frame, so a lookalike page cannot wrap the real tool and read what is typed into it.',
};

/**
 * React needs eval() in development for its debugging features, and never in
 * production. Relaxing only that, only locally, keeps connect-src enforced on the dev
 * server, so the claim can be tested without a build.
 */
export function contentSecurityPolicy({ dev = false, header = false } = {}): string {
  const list = header ? [...DIRECTIVES, FRAME_ANCESTORS] : DIRECTIVES;
  return list
    .map((d) => `${d.name} ${d.value}${dev && d.name === 'script-src' ? " 'unsafe-eval'" : ''}`)
    .join('; ');
}

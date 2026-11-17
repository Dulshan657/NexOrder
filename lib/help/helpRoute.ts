// Which help screen a URL asks for (NX-0038).
//
// The app has no router: every other screen lives at `/` and keeps its place in
// `?tab=`. The help centre is the one exception, because it is PUBLIC -- a link
// pasted into an email or printed in the PDF must open it signed out -- so it
// needs a path of its own that `index.tsx` can branch on before AuthGate.
//
// `vercel.ts`'s catch-all rewrite already serves index.html for `/help*`.

export type HelpRoute =
  | { kind: 'index' }
  | { kind: 'article'; slug: string }
  | { kind: 'print' }

/** Lowercase words joined by single hyphens -- the shape every manifest slug has. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * `/help` → index, `/help/print` → the printable guide, `/help/<slug>` → that
 * article. A trailing slash is tolerated. Anything else -- including `/helpdesk`
 * and deeper paths -- is not a help URL and returns null, so the normal app runs.
 *
 * An unknown but well-formed slug still returns `article`: the help centre says
 * "not found" itself, which is kinder than dropping a reader on the login page.
 */
export function parseHelpPath(pathname: string): HelpRoute | null {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (trimmed === '/help') return { kind: 'index' }
  if (!trimmed.startsWith('/help/')) return null

  const rest = trimmed.slice('/help/'.length)
  if (rest === 'print') return { kind: 'print' }
  if (!SLUG.test(rest)) return null
  return { kind: 'article', slug: rest }
}

/** The URL of one article, optionally keeping the reader's audience filter. */
export function helpArticleHref(slug: string, audience?: string | null): string {
  return `/help/${slug}${audience ? `?for=${audience}` : ''}`
}

/** The index, optionally filtered to one audience. */
export function helpIndexHref(audience?: string | null): string {
  return audience ? `/help?for=${audience}` : '/help'
}

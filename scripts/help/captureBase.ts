// Where the help-guide screenshot run may point (NX-0038).
//
// The capture script drives a REAL receipt and putaway, so it writes stock. It
// is a standalone script, not a Playwright project, which means it inherits
// none of `playwright.config.ts`'s tenant-origin refusal -- this is its own.
// Only the demo, or a local dev server (which reads `.env.dev.local`, i.e. the
// demo database), is allowed. A client's site is refused by name.

import { TARGETS } from '../../config/environments.mjs'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/** Returns the base URL with no trailing slash, or throws if it is not the demo or local. */
export function assertCaptureBase(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Not a URL: ${JSON.stringify(raw)}`)
  }

  const demo = new URL(TARGETS.dev.appOrigin)
  const isDemo = url.origin === demo.origin
  const isLocal = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
  if (!isDemo && !isLocal) {
    throw new Error(
      `Refusing to capture help screenshots from ${url.origin}: the run receives real stock, ` +
        `so it may only point at the demo (${demo.origin}) or a local dev server.`,
    )
  }
  return url.origin
}

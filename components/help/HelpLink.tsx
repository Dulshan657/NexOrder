// The "?" in a page header that opens that screen's help article (NX-0038).
//
// A new tab on purpose: on Receive Stock the operator may be half-way through a
// delivery, and on Putaway the scan field holds focus. Reading help must not
// cost either. The help centre needs no sign-in, so the new tab just works.

import React from 'react'
import { CircleHelp } from 'lucide-react'
import { helpArticleHref } from '../../lib/help/helpRoute'

export function HelpLink({ slug, topic }: { slug: string; topic: string }) {
  return (
    <a
      href={helpArticleHref(slug)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Help: ${topic}`}
      title={`Help: ${topic}`}
      className="touch-target inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white p-1.5 text-stone-700 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark"
    >
      <CircleHelp className="h-5 w-5" aria-hidden="true" />
    </a>
  )
}

export default HelpLink

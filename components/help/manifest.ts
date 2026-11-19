// The help centre's table of contents (NX-0038). Pure data.
//
// Order here is reading order: the index, the sidebar and the printed guide all
// follow it. Phase 1 of Peter's Warehouse Journey Map -- Receipt & Putaway --
// with its six steps folded into four how-to articles, plus the supervisor's
// side and the trouble table.

import type { HelpAudience } from '../../lib/help/helpAudience'

export type HelpSection = 'Getting started' | 'Receiving' | 'Putaway' | 'Checking stock' | 'Supervisors' | 'Troubleshooting'

export interface HelpArticleMeta {
  slug: string
  title: string
  summary: string
  section: HelpSection
  audiences: HelpAudience[]
}

const EVERYONE: HelpAudience[] = ['floor', 'supervisor']

export const HELP_ARTICLES: HelpArticleMeta[] = [
  {
    slug: 'warehouse-journey',
    title: 'The warehouse journey',
    summary: 'How goods move from the truck to the shelf, and where each step happens in Nex Order.',
    section: 'Getting started',
    audiences: EVERYONE,
  },
  {
    slug: 'receive-a-delivery',
    title: 'Receive a delivery',
    summary: 'Pick the supplier, scan each carton, check the quantities and book the delivery into stock.',
    section: 'Receiving',
    audiences: EVERYONE,
  },
  {
    slug: 'put-a-pallet-away',
    title: 'Put a pallet away',
    summary: 'Carry each pallet to the location Nex Order chose, scan to confirm, and count what you placed.',
    section: 'Putaway',
    audiences: EVERYONE,
  },
  {
    slug: 'check-stock-location',
    title: 'Check the stock is in its location',
    summary: 'Scan a location to see exactly what is in it, and count it if it looks wrong.',
    section: 'Checking stock',
    audiences: EVERYONE,
  },
  {
    slug: 'assign-putaway',
    title: 'Assign putaway to the team',
    summary: 'Review the locations Nex Order suggests for each received line and send them to the walk.',
    section: 'Supervisors',
    audiences: ['supervisor'],
  },
  {
    slug: 'if-something-goes-wrong',
    title: 'If something goes wrong',
    summary: 'The common problems on the dock and at the rack, and what to do about each.',
    section: 'Troubleshooting',
    audiences: EVERYONE,
  },
]

export const HELP_SECTIONS: HelpSection[] = [
  'Getting started',
  'Receiving',
  'Putaway',
  'Checking stock',
  'Supervisors',
  'Troubleshooting',
]

export function findArticle(slug: string): HelpArticleMeta | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug)
}

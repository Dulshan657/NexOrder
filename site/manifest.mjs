// The public documentation set, and the single source for /llms.txt.
//
// llms.txt is GENERATED from this list, which is the point of having it: a doc
// cannot ship unlisted, and the index cannot name a page that does not exist.
// Same reasoning as `check-csp.mjs` deriving from the target registry rather
// than restating it.
//
// Everything in site/ is PUBLIC. That is a property of the directory, not a rule
// people have to remember: docs/ holds runbooks and an internal product spec, so
// a glob over that would eventually publish one.

export const SITE_DOCS = [
  {
    slug: 'overview',
    title: 'What Nex Order is',
    summary:
      'Order management for wholesale distribution, from the inbound purchase order to the loading dock.',
  },
  {
    slug: 'capabilities',
    title: 'Capabilities',
    summary:
      'The modules a deployment can carry: orders, self-service ordering, inbound-PO email, warehouse operations, field visits, promotions and invoicing.',
  },
  {
    slug: 'accessibility',
    title: 'Accessibility statement',
    summary:
      'WCAG 2.2 AA conformance status, the exceptions we know about with measured figures, and how to report a barrier.',
  },
  {
    slug: 'contact',
    title: 'Contact',
    summary: 'Who makes Nex Order and how to reach us.',
  },
]

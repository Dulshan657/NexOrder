// The help centre: a public, unlisted reading surface at /help (NX-0038).
//
// Rendered by `index.tsx` BEFORE AuthGate, so it must work signed out: nothing
// in components/help imports auth, supabase or react-query. Links are plain
// anchors -- each is a full page load, which re-runs `parseHelpPath` in Root and
// needs no router.
//
// Layout is ordinary document flow, NOT the AppShell's `h-svh` + inner scroller:
// a fixed-height frame would print as one clipped page.
//
// Three views from one set of article components:
//   index   -- sections and article links, filtered by `?for=`
//   article -- one article, with a way back
//   print   -- the whole guide as an A4 document (cover + every article),
//              which scripts/help/build-guide-pdf.ts turns into the PDF

import React from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import type { HelpRoute } from '../../lib/help/helpRoute'
import { helpArticleHref, helpIndexHref } from '../../lib/help/helpRoute'
import { type HelpAudience, visibleArticles } from '../../lib/help/helpAudience'
import { HELP_ARTICLES, HELP_SECTIONS, findArticle, type HelpArticleMeta } from './manifest'
import { ARTICLE_BODIES } from './articles'
import { JourneyMap } from './articles/WarehouseJourney'
import './helpPrint.css'

export interface HelpCentreProps {
  route: HelpRoute
  audience: HelpAudience | null
}

const AUDIENCE_LABEL: Record<HelpAudience, string> = {
  floor: 'the warehouse team',
  supervisor: 'supervisors and managers',
}

const LINK = 'font-semibold text-nexgen-blue-dark underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark rounded'

function TopBar() {
  return (
    <header className="bg-nexgen-navy text-white print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <a href="/help" className="font-display text-lg font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">
          Nex Order Help
        </a>
        <a href="/" className="text-sm font-semibold text-white underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">
          Back to Nex Order
        </a>
      </div>
    </header>
  )
}

function grouped(articles: HelpArticleMeta[]) {
  return HELP_SECTIONS.map((section) => ({
    section,
    articles: articles.filter((a) => a.section === section),
  })).filter((g) => g.articles.length > 0)
}

function Sidebar({ articles, audience, current }: { articles: HelpArticleMeta[]; audience: HelpAudience | null; current?: string }) {
  return (
    <nav aria-label="Help articles" className="hidden md:block md:sticky md:top-6 md:self-start print:hidden">
      {grouped(articles).map((g) => (
        <div key={g.section} className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">{g.section}</p>
          <ul className="mt-1 space-y-1">
            {g.articles.map((a) => (
              <li key={a.slug}>
                <a
                  href={helpArticleHref(a.slug, audience)}
                  aria-current={a.slug === current ? 'page' : undefined}
                  className={`block rounded px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark ${
                    a.slug === current ? 'bg-nexgen-blue-light font-semibold text-nexgen-navy' : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <a href="/help/print" className={`mt-2 inline-flex items-center gap-1.5 text-sm ${LINK}`}>
        <Printer className="h-4 w-4" aria-hidden="true" /> Printable guide
      </a>
    </nav>
  )
}

function Frame({ children, sidebar }: { children: React.ReactNode; sidebar: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-stone-50">
      <TopBar />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 md:grid-cols-[220px_minmax(0,1fr)] md:py-10">
        {sidebar}
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  )
}

function IndexView({ audience }: { audience: HelpAudience | null }) {
  const articles = visibleArticles(HELP_ARTICLES, audience)
  return (
    <Frame sidebar={<Sidebar articles={articles} audience={audience} />}>
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-600">Warehouse · Phase 1</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-nexgen-navy sm:text-3xl">Receipt &amp; Putaway</h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-stone-700">
        Step-by-step help for getting a delivery from the truck onto the right shelf.
      </p>
      {audience && (
        <p className="mt-3 text-sm text-stone-700">
          Showing the articles for {AUDIENCE_LABEL[audience]}.{' '}
          <a href={helpIndexHref(null)} className={LINK}>
            Show all articles
          </a>
        </p>
      )}

      <div className="mt-6 space-y-6">
        {grouped(articles).map((g) => (
          <section key={g.section} aria-labelledby={`sec-${g.section}`}>
            <h2 id={`sec-${g.section}`} className="text-xs font-semibold uppercase tracking-wide text-stone-600">
              {g.section}
            </h2>
            <ul className="mt-2 grid max-w-3xl gap-3">
              {g.articles.map((a) => (
                <li key={a.slug}>
                  <a
                    href={helpArticleHref(a.slug, audience)}
                    className="block h-full rounded-xl border border-stone-200 bg-white p-4 hover:border-nexgen-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark"
                  >
                    <span className="block font-display font-bold text-nexgen-navy">{a.title}</span>
                    <span className="mt-1 block text-sm text-stone-700">{a.summary}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-8">
        <a href="/help/print" className={`inline-flex items-center gap-1.5 text-sm ${LINK}`}>
          <Printer className="h-4 w-4" aria-hidden="true" /> Printable guide (PDF)
        </a>
      </p>
    </Frame>
  )
}

function ArticleView({ slug, audience }: { slug: string; audience: HelpAudience | null }) {
  const meta = findArticle(slug)
  const Body = meta ? ARTICLE_BODIES[meta.slug] : undefined
  const articles = visibleArticles(HELP_ARTICLES, audience)
  const back = (
    <a href={helpIndexHref(audience)} className={`inline-flex items-center gap-1.5 text-sm ${LINK}`}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All articles
    </a>
  )

  return (
    <Frame sidebar={<Sidebar articles={articles} audience={audience} current={slug} />}>
      {back}
      {meta && Body ? (
        <article className="mt-4 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-600">{meta.section}</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-nexgen-navy sm:text-3xl">{meta.title}</h1>
          <div className="mt-2 h-1 w-16 rounded bg-nexgen-navy" aria-hidden="true" />
          <div className="mt-5">
            <Body />
          </div>
        </article>
      ) : (
        <div className="mt-4">
          <h1 className="font-display text-2xl font-bold text-nexgen-navy">Article not found</h1>
          <p className="mt-2 text-stone-700">That help article doesn't exist. Pick one from the list instead.</p>
        </div>
      )}
    </Frame>
  )
}

function PrintView() {
  return (
    <div className="bg-stone-200 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4 print:hidden">
        <a href="/help" className={`inline-flex items-center gap-1.5 text-sm ${LINK}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Help centre
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="btn-press touch-target inline-flex items-center gap-2 rounded-lg bg-nexgen-navy px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2"
        >
          <Printer className="h-4 w-4" aria-hidden="true" /> Print / Save as PDF
        </button>
      </div>

      <main>
        <section
          data-print-cover
          aria-label="Cover"
          className="help-print-cover mx-auto flex max-w-[210mm] flex-col justify-between overflow-hidden rounded-lg bg-gradient-to-b from-nexgen-navy to-[#071d33] p-[14mm] text-white shadow-lg aspect-[210/297]"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-white">Nex Order · Warehouse</p>
            <h1 className="mt-[18mm] font-display text-5xl font-bold leading-tight text-white">
              Receipt &amp; Putaway
              <br />
              Quick Guide
            </h1>
            <p className="mt-4 max-w-[130mm] text-lg text-white">
              From the truck at the dock to the product on its shelf, step by step with pictures.
            </p>
          </div>
          <div className="rounded-lg bg-white p-2">
            <JourneyMap />
          </div>
          <p className="text-sm text-white">Phase 1 of 3 · {new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</p>
        </section>

        <div className="help-print-body mx-auto mt-6 max-w-[210mm] bg-white px-[16mm] py-[12mm] shadow-lg print:mt-0 print:max-w-none print:p-0 print:shadow-none">
          {HELP_ARTICLES.map((a, i) => {
            const Body = ARTICLE_BODIES[a.slug]
            return (
              <section
                key={a.slug}
                data-print-article={a.slug}
                aria-labelledby={`print-${a.slug}`}
                className={`break-before-page ${i > 0 ? 'mt-12 print:mt-0' : ''}`}
              >
                <h2 id={`print-${a.slug}`} className="flex items-center gap-3 font-display text-2xl font-bold text-nexgen-navy">
                  <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-nexgen-navy text-lg text-white">
                    {i + 1}
                  </span>
                  {a.title}
                </h2>
                <p className="mt-1 text-stone-700">{a.summary}</p>
                <div className="mt-2 h-1 w-full rounded bg-nexgen-navy" aria-hidden="true" />
                <div className="mt-4">{Body && <Body />}</div>
              </section>
            )
          })}
        </div>
      </main>
    </div>
  )
}

export default function HelpCentre({ route, audience }: HelpCentreProps) {
  if (route.kind === 'print') return <PrintView />
  if (route.kind === 'article') return <ArticleView slug={route.slug} audience={audience} />
  return <IndexView audience={audience} />
}

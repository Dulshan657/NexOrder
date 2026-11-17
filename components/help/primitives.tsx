// The building blocks of a help article (NX-0038).
//
// The look follows the CheckLinx quick guides Peter holds up as the model: navy
// numbered steps, a "Good to know" / warning / tips box, and screenshots with
// lettered callouts. The same components render the in-app page and the printed
// PDF, so a print rule belongs here, never in a copy of the article.
//
// Contrast follows docs/claude/accessibility.md: body text stone-700/800, nothing
// lighter than stone-600 on a tinted box, and white only on nexgen-navy.
//
// Nothing here imports auth, supabase or react-query: the help centre is public
// and renders signed out.

import React from 'react'
import { ADMIN_TAB_LABELS, type AdminTab } from '../../lib/adminTabUrl'

/** An article section: an h2 that keeps its content on the same printed page. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 print:mt-5">
      <h2 className="font-display text-lg font-bold text-nexgen-navy break-after-avoid">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  )
}

/** A numbered list of steps. Each child should be a `<Step>`. */
export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol aria-label="Steps" className="space-y-3">
      {children}
    </ol>
  )
}

export function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 break-inside-avoid">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-nexgen-navy text-sm font-bold text-white"
      >
        {n}
      </span>
      <div className="min-w-0 pt-0.5 text-[15px] leading-relaxed text-stone-800">{children}</div>
    </li>
  )
}

const CALLOUT = {
  good: { title: 'Good to know', box: 'border-emerald-600 bg-emerald-50', head: 'text-emerald-800' },
  warn: { title: 'Watch out', box: 'border-amber-500 bg-amber-50', head: 'text-amber-900' },
  tip: { title: 'Tips', box: 'border-emerald-600 bg-emerald-50', head: 'text-emerald-800' },
} as const

/** The green / amber box with a bold heading and a left rule. */
export function Callout({
  kind,
  title,
  children,
}: {
  kind: keyof typeof CALLOUT
  title?: string
  children: React.ReactNode
}) {
  const c = CALLOUT[kind]
  return (
    <aside className={`rounded-r-lg border-l-4 px-4 py-3 break-inside-avoid ${c.box}`}>
      <p className={`font-semibold ${c.head}`}>{title ?? c.title}</p>
      <div className="mt-1 space-y-1 text-[15px] leading-relaxed text-stone-800">{children}</div>
    </aside>
  )
}

/** A button or field name as it reads on screen, e.g. <Ui>Receive 1 line</Ui>. */
export function Ui({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-md border border-nexgen-navy/40 bg-white px-1.5 py-px font-semibold text-nexgen-navy text-[0.9em] whitespace-nowrap">
      {children}
    </span>
  )
}

/** A screen name, read from the same label map the sidebar uses so the two cannot drift. */
export function TabName({ tab }: { tab: AdminTab }) {
  return (
    <span className="inline-block rounded-md bg-nexgen-blue-light px-1.5 py-px font-semibold text-nexgen-navy whitespace-nowrap">
      {ADMIN_TAB_LABELS[tab]}
    </span>
  )
}

export interface ShotMarker {
  /** The letter on the badge, also used in the legend. */
  label: string
  /** Badge centre, as a percentage of the image's width and height. */
  x: number
  y: number
  /** What the letter points at. Read by everyone, including screen readers. */
  text: string
}

/**
 * A screenshot with lettered callouts. The badges are decoration (aria-hidden);
 * the legend underneath carries the same information as text, so nothing is
 * conveyed by position alone.
 */
export function Shot({
  src,
  alt,
  caption,
  markers = [],
  wide = false,
}: {
  src: string
  alt: string
  caption?: string
  markers?: ShotMarker[]
  /** A desktop screenshot; phone screenshots are shown at phone width. */
  wide?: boolean
}) {
  return (
    <figure className={`break-inside-avoid ${wide ? 'w-full' : 'mx-auto w-full max-w-[280px] print:max-w-[165px]'}`}>
      <div className="relative overflow-hidden rounded-xl border border-stone-300 bg-white shadow-sm">
        <img src={src} alt={alt} loading="eager" decoding="sync" className="block h-auto w-full" />
        {markers.length > 0 && (
          <div aria-hidden="true">
            {markers.map((m) => (
              <span
                key={m.label}
                data-shot-badge
                style={{ left: `${m.x}%`, top: `${m.y}%` }}
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-orange-700 text-xs font-bold text-white ring-2 ring-white"
              >
                {m.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {(caption || markers.length > 0) && (
        <figcaption className="mt-2 text-center text-sm text-stone-600">
          {caption && <span className="italic">{caption}</span>}
          {markers.length > 0 && (
            <ol aria-label="Callouts" className="mt-1 space-y-0.5 text-left not-italic">
              {markers.map((m) => (
                <li key={m.label} className="flex gap-2">
                  <span className="font-bold text-orange-800">{m.label}</span>
                  <span className="text-stone-700">{m.text}</span>
                </li>
              ))}
            </ol>
          )}
        </figcaption>
      )}
    </figure>
  )
}

/** Steps on one side, the screenshot on the other; stacked on a phone. */
export function WithShot({ shot, children }: { shot: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px] md:items-start print:grid-cols-[minmax(0,1fr)_165px]">
      <div className="min-w-0 space-y-4">{children}</div>
      {shot}
    </div>
  )
}

/** The "If something goes wrong" table. */
export function TroubleTable({ rows }: { rows: { problem: React.ReactNode; fix: React.ReactNode }[] }) {
  return (
    <table className="w-full border-collapse text-left text-[15px]">
      <thead>
        <tr className="bg-nexgen-navy text-white">
          <th scope="col" className="w-2/5 px-3 py-2 font-semibold">
            Problem
          </th>
          <th scope="col" className="px-3 py-2 font-semibold">
            What to do
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-stone-200 align-top break-inside-avoid">
            <td className="px-3 py-2.5 text-stone-800">{r.problem}</td>
            <td className="px-3 py-2.5 text-stone-800">{r.fix}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

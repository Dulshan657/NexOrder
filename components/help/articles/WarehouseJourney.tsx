import React from 'react'
import { Callout, Section } from '../primitives'
import journeyMap from '../shots/journey-map.jpg'

const PHASE1 = [
  { n: 1, title: 'Receive', body: 'Book the delivery in: supplier, cartons, quantities.', where: 'Receive Stock' },
  { n: 2, title: 'Put away', body: 'Carry each pallet to the location Nex Order chose and scan it.', where: 'Putaway → Walk' },
  { n: 3, title: 'Check', body: 'Scan a location to see exactly what is in it.', where: 'Stock → Look up' },
]

/** The three-card summary, shared with the printed guide's "How it works" page. */
export function HowItWorks() {
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {PHASE1.map((p) => (
        <li key={p.n} className="rounded-xl border border-stone-200 bg-white p-4 text-center break-inside-avoid">
          <span
            aria-hidden="true"
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-nexgen-navy text-sm font-bold text-white"
          >
            {p.n}
          </span>
          <p className="mt-2 font-display font-bold text-nexgen-navy">{p.title}</p>
          <p className="mt-1 text-sm text-stone-700">{p.body}</p>
          <p className="mt-2 text-xs font-semibold text-stone-600">{p.where}</p>
        </li>
      ))}
    </ol>
  )
}

/** Peter's Key Benefits and Quick Tips bands, as text. */
export function BenefitsAndTips() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Callout kind="good" title="Why it matters">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Accurate inventory</b>: stock is where the system says it is.
          </li>
          <li>
            <b>Faster operations</b>: pickers find goods first time.
          </li>
          <li>
            <b>Happy customers</b>: orders go out complete and on time.
          </li>
        </ul>
      </Callout>
      <Callout kind="tip" title="Quick tips">
        <ul className="list-disc space-y-1 pl-5">
          <li>Always scan barcodes where you can.</li>
          <li>Check quantities before you confirm.</li>
          <li>Put away to the location you are shown.</li>
          <li>Ask your supervisor if you are unsure.</li>
        </ul>
      </Callout>
    </div>
  )
}

export function JourneyMap() {
  return (
    <figure className="break-inside-avoid">
      <img
        src={journeyMap}
        alt="Our Warehouse Journey Map. Phase 1, Receipt and Putaway, in six steps: receive delivery, record receipt, verify stock, find storage location, put away products, check and complete. Phase 2 is pick, pack and ship; phase 3 is deliver and invoice."
        loading="eager"
        className="block h-auto w-full rounded-xl border border-stone-200"
      />
    </figure>
  )
}

export default function WarehouseJourney() {
  return (
    <>
      <p className="text-[15px] leading-relaxed text-stone-800">
        Every product goes on the same journey through the warehouse, in three phases. This guide covers{' '}
        <b>Phase 1: Receipt &amp; Putaway</b>, from the truck at the dock to the product on its shelf. Phase 2 (pick,
        pack &amp; ship) and Phase 3 (deliver &amp; invoice) get their own guides.
      </p>
      {/* The printed guide carries the map on its cover; don't print it twice. */}
      <div className="print:hidden">
        <JourneyMap />
      </div>
      <Section title="How it works">
        <HowItWorks />
      </Section>
      <Section title="The six steps, and where they happen">
        <ul className="space-y-2 text-[15px] leading-relaxed text-stone-800">
          <li>
            <b>1 Receive delivery, 2 Record receipt, 3 Verify stock</b>: all on the Receive Stock screen. See{' '}
            <a className="font-semibold text-nexgen-blue-dark underline" href="/help/receive-a-delivery">
              Receive a delivery
            </a>
            .
          </li>
          <li>
            <b>4 Find storage location, 5 Put away products</b>: the Walk on the Putaway screen. See{' '}
            <a className="font-semibold text-nexgen-blue-dark underline" href="/help/put-a-pallet-away">
              Put a pallet away
            </a>
            .
          </li>
          <li>
            <b>6 Check &amp; complete</b>: Stock → Look up. See{' '}
            <a className="font-semibold text-nexgen-blue-dark underline" href="/help/check-stock-location">
              Check the stock is in its location
            </a>
            .
          </li>
        </ul>
      </Section>
      <BenefitsAndTips />
    </>
  )
}

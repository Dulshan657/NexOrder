import React from 'react'
import { Callout, Section, TroubleTable, Ui } from '../primitives'

export default function SomethingWrong() {
  return (
    <>
      <Callout kind="good" title="Still stuck?">
        Ask your supervisor. Supervisors can see every receipt and putaway, and can fix a mistake with a stock transfer
        or adjustment.
      </Callout>
      <Section title="On the dock (receiving)">
        <TroubleTable
          rows={[
            {
              problem: (
                <>
                  <Ui>Receive</Ui> is greyed out and says <i>Choose a supplier to receive</i>
                </>
              ),
              fix: 'Pick the supplier at the top first. If they are new, type their name and tap Create.',
            },
            {
              problem: 'A scan finds nothing',
              fix: (
                <>
                  The product may be listed under another supplier. Tap <b>Show all products</b> under the scan field,
                  or type the name or SKU.
                </>
              ),
            },
            {
              problem: 'Wrong quantity on a line',
              fix: (
                <>
                  Fix it with <Ui>−</Ui> / <Ui>+</Ui> or type the number, before you tap Receive.
                </>
              ),
            },
            {
              problem: 'Goods arrived damaged',
              fix: 'Tick Quarantine this delivery (or Hold this line back on one line) and tell your supervisor.',
            },
            {
              problem: "The carton isn't what the label says",
              fix: 'Tap Not this product? on the line (or on the Walk stop), pick what is really in the carton and count it. It is recorded as that product and held, and the desk is told to check the barcode.',
            },
            {
              problem: 'Barcode damaged or missing',
              fix: 'Receive it by typing the name, then print a plate label from the receipt and stick it on the pallet.',
            },
          ]}
        />
      </Section>

      <Section title="At the rack (putaway)">
        <TroubleTable
          rows={[
            {
              problem: 'The Walk says Nothing to carry',
              fix: 'Nothing has been assigned yet. Ask your supervisor to assign the lines on the Assign tab.',
            },
            {
              problem: 'The location is full or blocked',
              fix: 'Put the goods in a nearby empty location and scan that one. A different bay is accepted and recorded.',
            },
            {
              problem: 'The scan says the location already holds another product',
              fix: 'One product per location. Take it to an empty location, or to its home if the message names one, and tell your supervisor what you found there.',
            },
            {
              problem: 'The location scan is refused',
              fix: 'Check you scanned the location label, not a product. Type the code shown under Take it to if the label will not scan.',
            },
            {
              problem: "Can't finish a stop now",
              fix: (
                <>
                  Tap <Ui>Put it back on the queue</Ui>. Someone else can pick it up later.
                </>
              ),
            },
            {
              problem: 'The help page opened in a new tab',
              fix: 'That is on purpose, so your delivery or scan is not lost. Close the tab to go back.',
            },
          ]}
        />
      </Section>

    </>
  )
}

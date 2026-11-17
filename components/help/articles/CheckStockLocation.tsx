import React from 'react'
import { Callout, Section, Shot, Step, Steps, TabName, Ui, WithShot } from '../primitives'
import stockLookup from '../shots/stock-lookup.png'

export default function CheckStockLocation() {
  return (
    <>
      <p className="text-[15px] leading-relaxed text-stone-800">
        The last step of the journey: make sure what the system says is what is on the shelf. This screen only reads,
        so scanning here never changes stock.
      </p>

      <Section title="Look up a bin">
        <WithShot
          shot={
            <Shot
              src={stockLookup}
              alt="Stock, Look up: location AMADIYA-FAST.A-2-1-L3 holds one product, Roasted Curry Powder, quantity 9."
              caption="What is in a bin"
              markers={[
                { label: 'A', x: 4, y: 19.5, text: 'Look up' },
                { label: 'B', x: 4, y: 42, text: 'The bin you scanned' },
                { label: 'C', x: 4, y: 58, text: 'Count this bin' },
                { label: 'D', x: 4, y: 72, text: 'What is in it, and how many' },
                { label: 'E', x: 4, y: 95.5, text: 'Scan field' },
              ]}
            />
          }
        >
          <Steps>
            <Step n={1}>
              Open <TabName tab="Stock" /> and make sure <b>Look up (A)</b> is selected.
            </Step>
            <Step n={2}>Scan the bin label (E). You see the bin (B) and every product in it with its quantity (D).</Step>
            <Step n={3}>Compare it with what is physically on the shelf.</Step>
            <Step n={4}>
              It doesn't match? Tap <Ui>Count this bin</Ui> (C) and enter what is really there.
            </Step>
          </Steps>
          <Callout kind="tip">
            <p>Scan a product barcode instead of a bin to see every location that holds that product.</p>
            <p>Label won't scan? Type the code into the same field.</p>
          </Callout>
        </WithShot>
      </Section>
    </>
  )
}

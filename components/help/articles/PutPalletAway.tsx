import React from 'react'
import { Callout, Section, Shot, Step, Steps, TabName, Ui, WithShot } from '../primitives'
import putawayWalk from '../shots/putaway-walk.png'
import putawayBin from '../shots/putaway-bin.png'
import putawayCount from '../shots/putaway-count.png'

export default function PutPalletAway() {
  return (
    <>
      <p className="text-[15px] leading-relaxed text-stone-800">
        After a delivery is received, its pallets wait on the dock. The <b>Walk</b> lists each one with the location Nex
        Order chose for it, in the order that makes the shortest trip. <b>The stock only moves when you scan the location.</b>
      </p>

      <Section title="1. Pick up the next stop">
        <WithShot
          shot={
            <Shot
              src={putawayWalk}
              alt="The Putaway Walk tab listing numbered stops, each with a location code, product, quantity and plate."
              caption="The Walk: one stop per pallet"
              markers={[
                { label: 'A', x: 41, y: 21.6, text: 'Walk tab, with the number of stops' },
                { label: 'B', x: 4, y: 53, text: 'A stop: location, product, quantity, plate' },
                { label: 'C', x: 4, y: 95.5, text: 'Scan a plate, carton or location' },
              ]}
            />
          }
        >
          <Steps>
            <Step n={1}>
              Open <TabName tab="Putaway" />. On the handheld it opens on the <b>Walk</b> tab (A).
            </Step>
            <Step n={2}>
              Scan the pallet's carton or plate into the field at the bottom (C). Nex Order scrolls to its stop.
            </Step>
            <Step n={3}>Tap the stop (B) to open it.</Step>
          </Steps>
          <Callout kind="good">
            A big delivery can be split over several stops when one location can't hold it all. Each stop says how much goes
            in that location.
          </Callout>
        </WithShot>
      </Section>

      <Section title="2. Take it to the location and scan">
        <WithShot
          shot={
            <Shot
              src={putawayBin}
              alt="An open putaway stop: Take it to AMADIYA-FAST.A-2-1-L3, quantity 9, plate HU-001321, and the scan-the-location field."
              caption="An open stop"
              markers={[
                { label: 'A', x: 4, y: 10, text: 'Progress: Product, Location, Count' },
                { label: 'B', x: 4, y: 24, text: 'Take it to: the location to use' },
                { label: 'C', x: 4, y: 41, text: 'How much, and which plate' },
                { label: 'D', x: 4, y: 71, text: 'Scan the location' },
                { label: 'E', x: 4, y: 83, text: 'Put it back on the queue' },
              ]}
            />
          }
        >
          <Steps>
            <Step n={4}>
              If asked, scan the product barcode first. The progress bar (A) ticks <b>Product</b>.
            </Step>
            <Step n={5}>
              Read <b>Take it to (B)</b> and drive to that location. The line under it names the area, rack and level, e.g.{' '}
              <i>Fast Movers · Rack 2 · L3</i>.
            </Step>
            <Step n={6}>
              Place the goods, then scan the <b>location label</b> on the rack into the field (D).
            </Step>
          </Steps>
          <Callout kind="warn" title="Location full or blocked?">
            Use a nearby location and scan that one instead. A different bay is accepted and recorded, so the system still
            knows where the stock is. Can't do the stop now? Tap <Ui>Put it back on the queue</Ui> (E).
          </Callout>
        </WithShot>
      </Section>

      <Section title="3. Count and confirm">
        <WithShot
          shot={
            <Shot
              src={putawayCount}
              alt="The count step: How much did you put away, 9 of 9 on this task, and a green Confirm button."
              caption="The count step"
              markers={[
                { label: 'A', x: 4, y: 62, text: 'How much did you put away?' },
                { label: 'B', x: 4, y: 71, text: 'Confirm' },
              ]}
            />
          }
        >
          <Steps>
            <Step n={7}>
              Check the number in <b>How much did you put away? (A)</b>. It starts at the full amount. Change it if you
              placed less.
            </Step>
            <Step n={8}>
              Tap <Ui>Confirm</Ui> (B). The stop leaves the Walk and the stock is now in that location.
            </Step>
          </Steps>
          <Callout kind="good">
            Placed less than the stop asked for? Whatever is left stays on the Walk as its own stop, so nothing is lost.
          </Callout>
        </WithShot>
      </Section>

      <Section title="When the barcode is damaged">
        <p className="text-[15px] leading-relaxed text-stone-800">
          Tap <b>Barcode damaged? Print a plate label</b> on the stop, stick the label on the pallet and scan that
          instead. The plate label identifies the pallet just as well as the product barcode.
        </p>
      </Section>
    </>
  )
}

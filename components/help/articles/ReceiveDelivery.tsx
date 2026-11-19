import React from 'react'
import { Callout, Section, Shot, Step, Steps, TabName, Ui, WithShot } from '../primitives'
import receiveStart from '../shots/receive-start.png'
import receiveScanned from '../shots/receive-scanned.png'
import receiveDone from '../shots/receive-done.png'

export default function ReceiveDelivery() {
  return (
    <>
      <p className="text-[15px] leading-relaxed text-stone-800">
        Use this when a truck arrives. You record who it came from, scan every carton, check the numbers and book it in.
        Nothing is on a shelf yet. That is the next step, putaway.
      </p>

      <Section title="1. Enter the delivery details">
        <WithShot
          shot={
            <Shot
              src={receiveStart}
              alt="The Receive Stock screen on a handheld, before anything is scanned."
              caption="Receive Stock, ready for a delivery"
              markers={[
                { label: 'A', x: 6, y: 19, text: 'Supplier' },
                { label: 'B', x: 6, y: 30.5, text: 'Reference: invoice, docket or PO number' },
                { label: 'C', x: 6, y: 51, text: 'Quarantine this delivery' },
                { label: 'D', x: 6, y: 84, text: 'Scan field' },
                { label: 'E', x: 56, y: 92, text: 'Receive button' },
              ]}
            />
          }
        >
          <Steps>
            <Step n={1}>
              Open <TabName tab="Receiving" /> from the menu (☰).
            </Step>
            <Step n={2}>
              <b>Supplier (A)</b>: start typing the supplier's name and tap it in the list. Only that supplier's products
              will come up when you scan.
            </Step>
            <Step n={3}>
              <b>Reference (B)</b>: type the invoice, docket or PO number from the delivery note.
            </Step>
            <Step n={4}>
              <b>Received</b> is today's date. Change it only if you are entering yesterday's delivery.
            </Step>
          </Steps>
          <Callout kind="warn" title="Damaged or suspect goods?">
            Tick <b>Quarantine this delivery (C)</b>. The stock is booked in but held back, so nobody can pick it until a
            supervisor releases it.
          </Callout>
        </WithShot>
      </Section>

      <Section title="2. Scan every carton">
        <WithShot
          shot={
            <Shot
              src={receiveScanned}
              alt="Receive Stock after scanning three cartons of one product: one line, quantity 3 cartons."
              caption="Three cartons scanned"
              markers={[
                { label: 'A', x: 4, y: 27, text: 'The product you scanned' },
                { label: 'B', x: 4, y: 40, text: 'Quantity, with − and +' },
                { label: 'C', x: 4, y: 48, text: 'Unit: carton, or each' },
                { label: 'D', x: 4, y: 59, text: 'Lot code and expiry' },
                { label: 'E', x: 58, y: 86, text: 'Receive 1 line' },
              ]}
            />
          }
        >
          <Steps>
            <Step n={5}>
              Scan the barcode on the first carton into the <b>scan field (D above)</b>. The product appears as a line.
            </Step>
            <Step n={6}>Scan each carton as it comes off the truck. Every scan adds one to the count.</Step>
            <Step n={7}>
              No barcode, or it won't scan? Type the product name or SKU into the same field and pick it from the list.
            </Step>
            <Step n={8}>
              If the product needs a <b>lot code</b> or <b>expiry</b>, tap <Ui>Add lot / expiry</Ui> on the line (D) and
              copy them from the carton.
            </Step>
          </Steps>
          <Callout kind="good">
            <p>
              A second pallet of the same product? Tap <Ui>New pallet</Ui> (the stacked-layers button) before scanning
              it, so each pallet gets its own plate and its own location.
            </p>
            <p>
              One pallet with several products on it? Use <Ui>Mixed pallet</Ui> (the boxes button).
            </p>
          </Callout>
        </WithShot>
      </Section>

      <Section title="3. Check the quantities and book it in">
        <WithShot
          shot={
            <Shot
              src={receiveDone}
              alt="The receipt recorded screen with Go to putaway, Start next delivery and the plate labels panel."
              caption="The delivery is booked in"
              markers={[
                { label: 'A', x: 4, y: 26, text: 'Go to putaway' },
                { label: 'B', x: 4, y: 46, text: 'Plate labels' },
                { label: 'C', x: 4, y: 80, text: 'Suggested locations' },
              ]}
            />
          }
        >
          <Steps>
            <Step n={9}>
              Count the cartons against the delivery note. Fix any line with <Ui>−</Ui> / <Ui>+</Ui>, or type the number.
            </Step>
            <Step n={10}>
              Tap <Ui>Receive 1 line</Ui> (it counts your lines). You'll see <b>Received 1 line into stock</b>.
            </Step>
            <Step n={11}>
              Tap <Ui>Go to putaway</Ui> (A) to start putting it away, or <Ui>Start next delivery</Ui> for the next
              truck.
            </Step>
          </Steps>
          <Callout kind="good">
            Every pallet gets a <b>plate</b> number, like HU-001321. You only need to print a plate label (B) if the
            product barcode is missing or damaged. Otherwise the product barcode identifies it at the rack.
          </Callout>
        </WithShot>
      </Section>
    </>
  )
}

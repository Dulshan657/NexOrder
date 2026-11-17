import React from 'react'
import { Callout, Section, Shot, Step, Steps, TabName, Ui } from '../primitives'
import putawayAssign from '../shots/putaway-assign.png'

export default function AssignPutaway() {
  return (
    <>
      <p className="text-[15px] leading-relaxed text-stone-800">
        <b>For supervisors and managers.</b> When a delivery is received, Nex Order suggests a location for each line. The{' '}
        <b>Assign</b> tab is where you check those suggestions and send the lines to the Walk for the team to carry.
        Nothing moves until someone scans the location on the Walk.
      </p>

      <Section title="Review and assign">
        <Shot
          wide
          src={putawayAssign}
          alt="The Putaway Assign tab on a desktop: a list of received lines, each with a suggested location and Choose location, Place now and Assign buttons."
          caption="Putaway → Assign"
          markers={[
            { label: 'A', x: 69, y: 7, text: 'Warehouse' },
            { label: 'B', x: 19.5, y: 15.3, text: 'Assign tab' },
            { label: 'C', x: 87, y: 26.5, text: 'Assign all' },
            { label: 'D', x: 57, y: 36, text: 'The suggested location' },
            { label: 'E', x: 73.5, y: 32.5, text: 'Choose location' },
            { label: 'F', x: 91, y: 32.5, text: 'Assign' },
          ]}
        />
        <Steps>
          <Step n={1}>
            Open <TabName tab="Putaway" /> and pick the <b>Warehouse (A)</b>. Open the <b>Assign</b> tab (B).
          </Step>
          <Step n={2}>
            Each line shows the product, how much, and the <b>suggested location (D)</b>. Tap the <Ui>?</Ui> next to it to see
            why that location was chosen.
          </Step>
          <Step n={3}>
            Happy with it? Tap <Ui>Assign</Ui> (F). The line goes to the Walk.
          </Step>
          <Step n={4}>
            Want a different location? Tap <Ui>Choose location</Ui> (E), pick one, then assign.
          </Step>
          <Step n={5}>
            All suggestions look right? <Ui>Assign all</Ui> (C) sends every line that has a location in one go.
          </Step>
        </Steps>
        <Callout kind="good">
          <p>
            Use the filter to find <b>No eligible location</b> lines. Nex Order could not find room for these, so choose a location
            by hand.
          </p>
          <p>
            <Ui>Place now</Ui> moves the stock straight into the location without a Walk. Only use it when the goods are already
            on the shelf.
          </p>
        </Callout>
      </Section>
    </>
  )
}

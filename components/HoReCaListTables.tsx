// The two tables of the customer tab (NX-0027): Details, for looking a customer up and
// chasing what is missing, and Sales, the figures the tab always had. The list view owns the
// filters and the actions menu and hands each table the rows to show.

import React from 'react';
import type { HoReCa, HoReCaInsights } from '../types';
import SegmentBadge from './SegmentBadge';
import { cleanAddress, cleanText, customerBrands } from '../lib/horecaListFilters';

type Align = 'left' | 'right';

const HEAD =
  'px-5 py-3.5 text-xs font-semibold text-stone-500 uppercase tracking-wider';
const CELL = 'px-5 py-3.5';

const TIER_COLORS: Record<string, string> = {
  Gold: 'bg-amber-50 text-amber-800 border-amber-200',
  Silver: 'bg-stone-100 text-stone-700 border-stone-300',
  Bronze: 'bg-orange-50 text-orange-800 border-orange-200',
};

/**
 * A value the customer does not have. The words "Missing" are the signal, not the colour or
 * the dash it replaces, and the field is named for a screen reader, which reads cell by cell
 * without the column heading ("Missing phone"). Italic and stone-600 (7.6:1 on white,
 * docs/claude/accessibility.md) mark it as muted without dropping below the 4.5:1 floor.
 */
export const MissingValue: React.FC<{ field: string }> = ({ field }) => (
  <span className="text-sm italic text-stone-600">
    Missing<span className="sr-only"> {field}</span>
  </span>
);

/**
 * A customer who buys none of the tracked brands. That is not a missing detail (most do not),
 * so it is a dash, like the empty cells of the Sales view, with the words for a screen reader.
 */
const NoBrands: React.FC = () => (
  <span className="text-sm text-stone-500">
    <span aria-hidden="true">--</span>
    <span className="sr-only">No brands</span>
  </span>
);

const Head: React.FC<{ align?: Align; children?: React.ReactNode }> = ({ align = 'left', children }) => (
  <th scope="col" className={`${HEAD} ${align === 'right' ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
);

/** The card, the sideways scroll for a narrow screen, and the table. */
const TableShell: React.FC<{ head: React.ReactNode; children: React.ReactNode }> = ({ head, children }) => (
  <div className="glass-card rounded-xl overflow-hidden">
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-stone-200">
            {head}
            {/* The menu column has no heading to show, but it needs a name to be a column. */}
            <th scope="col" className={`${HEAD} text-right w-12`}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  </div>
);

interface RowProps {
  customer: HoReCa;
  last: boolean;
  onOpen: (customer: HoReCa) => void;
  actions: React.ReactNode;
}

const rowClass = (last: boolean): string =>
  `transition-colors hover:bg-stone-50/50 cursor-pointer ${last ? '' : 'border-b border-stone-100'}`;

/** The address under a customer's name: the address, or "Missing" for a blank or the placeholder. */
const AddressLine: React.FC<{ address: string | undefined }> = ({ address }) => {
  const text = cleanAddress(address);
  return text ? (
    <p className="text-xs text-stone-500 mt-0.5 truncate max-w-[250px]">{text}</p>
  ) : (
    <p className="mt-0.5"><MissingValue field="address" /></p>
  );
};

const ActionsCell: React.FC<{ actions: React.ReactNode }> = ({ actions }) => (
  <td className={`${CELL} text-right`}>{actions}</td>
);

/** A cell showing the text, or "Missing" when there is none. */
const TextCell: React.FC<{ value: unknown; field: string; className?: string }> = ({ value, field, className = '' }) => {
  const text = cleanText(value);
  return (
    <td className={`${CELL} text-sm text-stone-700 ${className}`}>
      {text ? text : <MissingValue field={field} />}
    </td>
  );
};

const DetailsRow: React.FC<RowProps> = ({ customer: h, last, onOpen, actions }) => {
  const address = cleanAddress(h.address);
  const brands = customerBrands(h);
  const email = cleanText(h.billingEmail);

  return (
    <tr onClick={() => onOpen(h)} className={rowClass(last)}>
      <td className={CELL}>
        <p className="text-sm font-medium text-stone-900">{h.name}</p>
      </td>
      <TextCell value={h.contactName} field="contact" />
      <TextCell value={h.phone} field="phone" className="whitespace-nowrap tabular-nums" />
      <td className={`${CELL} text-sm text-stone-700`}>
        {email ? <div className="max-w-[220px] truncate" title={email}>{email}</div> : <MissingValue field="email" />}
      </td>
      <td className={`${CELL} text-sm text-stone-700`}>
        {address ? <div className="max-w-[260px]">{address}</div> : <MissingValue field="address" />}
      </td>
      <TextCell value={h.abn} field="ABN" className="whitespace-nowrap tabular-nums" />
      <td className={`${CELL} text-sm text-stone-700`}>
        {brands.length > 0 ? <div className="max-w-[200px]">{brands.join(', ')}</div> : <NoBrands />}
      </td>
      <ActionsCell actions={actions} />
    </tr>
  );
};

interface SalesRowProps extends RowProps {
  insight: HoReCaInsights | undefined;
  outstanding: number | undefined;
  lastOrder: string | undefined;
}

const NoValue: React.FC = () => <span className="text-xs text-stone-500">--</span>;

const SalesRow: React.FC<SalesRowProps> = ({ customer: h, last, onOpen, actions, insight, outstanding, lastOrder }) => (
  <tr onClick={() => onOpen(h)} className={rowClass(last)}>
    <td className={CELL}>
      <p className="text-sm font-medium text-stone-900">{h.name}</p>
      <AddressLine address={h.address} />
    </td>
    <td className={CELL}>
      {h.tier ? (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${TIER_COLORS[h.tier] ?? 'bg-stone-100 text-stone-600 border-stone-200'}`}>
          {h.tier}
        </span>
      ) : <NoValue />}
    </td>
    <td className={CELL}>
      {insight ? <SegmentBadge segment={insight.segment} /> : <NoValue />}
    </td>
    <td className={`${CELL} text-right text-sm tabular-nums text-stone-700`}>
      {h.creditLimit ? `$${h.creditLimit.toLocaleString()}` : '--'}
    </td>
    <td className={`${CELL} text-sm text-stone-600`}>
      {lastOrder ? new Date(lastOrder).toLocaleDateString() : '--'}
    </td>
    <td className={`${CELL} text-right text-sm tabular-nums`}>
      {outstanding ? (
        <span className="font-semibold text-amber-700">${outstanding.toFixed(2)}</span>
      ) : (
        <span className="text-stone-500">--</span>
      )}
    </td>
    <ActionsCell actions={actions} />
  </tr>
);

interface TableProps {
  customers: readonly HoReCa[];
  onOpen: (customer: HoReCa) => void;
  renderActions: (customer: HoReCa) => React.ReactNode;
}

export const DetailsTable: React.FC<TableProps> = ({ customers, onOpen, renderActions }) => (
  <TableShell
    head={
      <>
        <Head>Customer</Head>
        <Head>Contact</Head>
        <Head>Phone</Head>
        <Head>Email</Head>
        <Head>Address</Head>
        <Head>ABN</Head>
        <Head>Brands</Head>
      </>
    }
  >
    {customers.map((h, idx) => (
      <DetailsRow key={h.id} customer={h} last={idx === customers.length - 1} onOpen={onOpen} actions={renderActions(h)} />
    ))}
  </TableShell>
);

interface SalesTableProps extends TableProps {
  insights: ReadonlyMap<number, HoReCaInsights>;
  outstanding: ReadonlyMap<number, number>;
  lastOrders: ReadonlyMap<number, string>;
}

export const SalesTable: React.FC<SalesTableProps> = ({ customers, onOpen, renderActions, insights, outstanding, lastOrders }) => (
  <TableShell
    head={
      <>
        <Head>Customer</Head>
        <Head>Tier</Head>
        <Head>Segment</Head>
        <Head align="right">Credit Limit</Head>
        <Head>Last Order</Head>
        <Head align="right">Outstanding</Head>
      </>
    }
  >
    {customers.map((h, idx) => (
      <SalesRow
        key={h.id}
        customer={h}
        last={idx === customers.length - 1}
        onOpen={onOpen}
        actions={renderActions(h)}
        insight={insights.get(h.id)}
        outstanding={outstanding.get(h.id)}
        lastOrder={lastOrders.get(h.id)}
      />
    ))}
  </TableShell>
);

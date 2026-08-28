import React, { useMemo, useState } from 'react';
import { useOrderDocuments, useOrderDocumentUrl } from '../../hooks/queries/useOrderDocuments';
import type { OrderDocumentView } from '../../services/supabase/orderDocumentService';
import { useToasts } from '../../hooks/useToasts';
import { useDocumentViewer } from '../../context/DocumentViewerContext';
import { downloadSignedDoc } from '../../lib/openSignedDoc';
import type { OrderDocument, OrderDocumentType } from '../../types';
import { FileText, Search, X, ExternalLink, Download, ClipboardList, Truck, ChevronDown, ChevronRight } from 'lucide-react';

const typeMeta: Record<OrderDocumentType, { label: string; cls: string; Icon: React.FC<{ className?: string }> }> = {
  pick_slip: { label: 'Pick slip', cls: 'bg-nexgen-blue/10 text-nexgen-blue', Icon: ClipboardList },
  dispatch_advice: { label: 'Dispatch advice', cls: 'bg-emerald-50 text-emerald-700', Icon: Truck },
};

const formatGenerated = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export interface OrderDocGroup {
  orderId: string;
  horecaName: string;
  pickSlips: OrderDocument[];
  dispatchAdvices: OrderDocument[];
}

/**
 * Collapse the newest-first document list into one entry per order, splitting
 * each order's docs into newest-first pick-slip / dispatch-advice arrays
 * (so `[0]` is the latest of each). First-seen order is preserved, so the most
 * recently active orders stay on top.
 */
export function groupByOrder(views: OrderDocumentView[]): OrderDocGroup[] {
  const order: string[] = [];
  const map = new Map<string, OrderDocGroup>();
  for (const v of views) {
    let g = map.get(v.doc.orderId);
    if (!g) {
      g = { orderId: v.doc.orderId, horecaName: v.horecaName, pickSlips: [], dispatchAdvices: [] };
      map.set(v.doc.orderId, g);
      order.push(v.doc.orderId);
    }
    if (v.doc.docType === 'pick_slip') g.pickSlips.push(v.doc);
    else g.dispatchAdvices.push(v.doc);
  }
  return order.map((id) => map.get(id)!);
}

const DocumentsView: React.FC = () => {
  const { addToast } = useToasts();
  const { previewDocument } = useDocumentViewer();
  const { data: docs, isLoading, isError } = useOrderDocuments();
  const getUrl = useOrderDocumentUrl();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | OrderDocumentType>('all');

  const matchesSearch = (orderId: string, horecaName: string, q: string) =>
    !q || orderId.toLowerCase().includes(q) || horecaName.toLowerCase().includes(q);

  // Flat list (used by the type-specific tabs).
  const flat = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (docs ?? []).filter(
      (d) => d.doc.docType === typeFilter && matchesSearch(d.doc.orderId, d.horecaName, q),
    );
  }, [docs, search, typeFilter]);

  // Grouped (one row per order) — used by the 'all' tab.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupByOrder(docs ?? []).filter((g) => matchesSearch(g.orderId, g.horecaName, q));
  }, [docs, search]);

  const onErr = (err: unknown) =>
    addToast(err instanceof Error ? err.message : 'Could not open document', 'error');

  const view = (id: number, orderId: string, docType: OrderDocumentType) =>
    previewDocument(() => getUrl.mutateAsync(id), `${orderId} · ${typeMeta[docType].label}`, `${orderId}-${docType}.pdf`);

  const download = (id: number, orderId: string, docType: OrderDocumentType) =>
    downloadSignedDoc(() => getUrl.mutateAsync(id), `${orderId}-${docType}.pdf`, { onError: onErr });

  const isEmpty = typeFilter === 'all' ? groups.length === 0 : flat.length === 0;

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-nexgen-blue/10">
          <FileText className="w-5 h-5 text-nexgen-blue" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Documents</h1>
          <p className="text-xs text-stone-500 mt-0.5">Pick slips &amp; dispatch advices generated for orders.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by order ID or customer…"
            className="w-full pl-10 pr-9 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-600 cursor-pointer"><X className="w-4 h-4" /></button>
          )}
        </div>
        <div className="flex gap-2">
          {(['all', 'pick_slip', 'dispatch_advice'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors btn-press ${typeFilter === t ? 'bg-nexgen-blue text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              {t === 'all' ? 'All' : typeMeta[t].label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="glass-card rounded-xl divide-y divide-stone-100">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse bg-stone-100/60" />)}
        </div>
      ) : isError ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <p className="text-sm text-red-600">Couldn't load documents.</p>
          <p className="text-xs text-stone-500 mt-1">Check your connection and try again.</p>
        </div>
      ) : isEmpty ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <FileText className="w-9 h-9 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-600">No documents yet</p>
          <p className="text-xs text-stone-500 mt-1">Pick slips and dispatch advices appear here once generated from the Pick Queue.</p>
        </div>
      ) : typeFilter === 'all' ? (
        /* Grouped — one row per order, both document types as columns */
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Order</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Customer</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Pick slip</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Dispatch advice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {groups.map((g) => (
                  <OrderDocGroupRow key={g.orderId} group={g} view={view} download={download} pending={getUrl.isPending} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Flat — one row per individual document of the selected type */
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Order</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Customer</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Type</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider">Generated</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {flat.map(({ doc, horecaName }) => {
                  const meta = typeMeta[doc.docType];
                  return (
                    <tr key={doc.id} className="hover:bg-stone-50/50">
                      <td className="px-5 py-3.5 font-mono text-sm text-stone-900">{doc.orderId}</td>
                      <td className="px-5 py-3.5 text-sm text-stone-600">{horecaName}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>
                          <meta.Icon className="w-3 h-3" /> {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-stone-500">{formatGenerated(doc.generatedAt)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <ActionButtons doc={doc} view={view} download={download} pending={getUrl.isPending} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

type DocAction = (id: number, orderId: string, docType: OrderDocumentType) => void;

const ActionButtons: React.FC<{ doc: OrderDocument; view: DocAction; download: DocAction; pending: boolean }> = ({ doc, view, download, pending }) => (
  <>
    <button
      onClick={() => view(doc.id, doc.orderId, doc.docType)}
      disabled={pending}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press disabled:opacity-50"
    >
      <ExternalLink className="w-3.5 h-3.5" /> View
    </button>
    <button
      onClick={() => download(doc.id, doc.orderId, doc.docType)}
      disabled={pending}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press disabled:opacity-50"
      aria-label="Download document"
    >
      <Download className="w-3.5 h-3.5" /> Download
    </button>
  </>
);

/** One type's cell on a grouped order row: latest View/Download + version expander. */
const TypeCell: React.FC<{
  docs: OrderDocument[];
  open: boolean;
  onToggle: () => void;
  view: DocAction;
  download: DocAction;
  pending: boolean;
}> = ({ docs, open, onToggle, view, download, pending }) => {
  if (docs.length === 0) return <span className="text-sm text-stone-300">—</span>;
  const latest = docs[0];
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <ActionButtons doc={latest} view={view} download={download} pending={pending} />
        {docs.length > 1 && (
          <button
            onClick={onToggle}
            className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded-md btn-press"
            title="Show earlier versions"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}×{docs.length}
          </button>
        )}
      </div>
      <p className="text-[11px] text-stone-500 pl-1">{formatGenerated(latest.generatedAt)}</p>
    </div>
  );
};

const OrderDocGroupRow: React.FC<{ group: OrderDocGroup; view: DocAction; download: DocAction; pending: boolean }> = ({ group, view, download, pending }) => {
  const [openHistory, setOpenHistory] = useState<OrderDocumentType | null>(null);
  const historyDocs = openHistory === 'pick_slip' ? group.pickSlips : openHistory === 'dispatch_advice' ? group.dispatchAdvices : [];

  return (
    <>
      <tr className="hover:bg-stone-50/50 align-top">
        <td className="px-5 py-3.5 font-mono text-sm text-stone-900">{group.orderId}</td>
        <td className="px-5 py-3.5 text-sm text-stone-600">{group.horecaName}</td>
        <td className="px-5 py-3.5">
          <TypeCell docs={group.pickSlips} open={openHistory === 'pick_slip'} onToggle={() => setOpenHistory((p) => (p === 'pick_slip' ? null : 'pick_slip'))} view={view} download={download} pending={pending} />
        </td>
        <td className="px-5 py-3.5">
          <TypeCell docs={group.dispatchAdvices} open={openHistory === 'dispatch_advice'} onToggle={() => setOpenHistory((p) => (p === 'dispatch_advice' ? null : 'dispatch_advice'))} view={view} download={download} pending={pending} />
        </td>
      </tr>
      {openHistory && (
        <tr className="bg-stone-50/60">
          <td colSpan={4} className="px-5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">
              {typeMeta[openHistory].label} versions
            </p>
            <ul className="space-y-1.5">
              {historyDocs.map((doc, i) => (
                <li key={doc.id} className="flex items-center gap-3">
                  <span className="text-xs text-stone-500 w-44">
                    {formatGenerated(doc.generatedAt)}
                    {i === 0 && <span className="ml-1.5 text-[10px] font-medium text-emerald-600">latest</span>}
                  </span>
                  <div className="flex items-center gap-1">
                    <ActionButtons doc={doc} view={view} download={download} pending={pending} />
                  </div>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
};

export default DocumentsView;

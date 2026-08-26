import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { HoReCa, Order, Invoice, User, Visit, HoReCaSegment, HoReCaTier } from '../types';
import { UserRole } from '../types';
import { Search, X, MoreVertical, Plus, ShoppingBag, Building2, Pencil, Trash2 } from 'lucide-react';
import SegmentBadge from './SegmentBadge';
import HoReCaForm from './HoReCaForm';
import ConfirmationDialog from './ConfirmationDialog';
import HoReCaProfile from './HoReCaProfile';
import VisitModal from './visits/VisitModal';
import { getHoReCaOutstanding } from '../services/accountingService';
import { computeAllHoReCaInsights } from '../services/buyingPatternsService';

interface HoReCaListViewProps {
  hoReCas: HoReCa[];
  orders: Order[];
  invoices: Invoice[];
  currentUser: User;
  visits?: Visit[];
  onAddHoReCa?: (customer: Omit<HoReCa, 'id'>, reason?: string) => void;
  onUpdateHoReCa?: (customer: HoReCa, reason?: string) => void;
  onDeleteHoReCa?: (hoReCaId: number) => void;
  onStartOrder?: (hoReCaId: number) => void;
  setVisits?: (visits: Visit[]) => void;
}

const SEGMENT_OPTIONS: { value: HoReCaSegment | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'high_value', label: 'High Value' },
  { value: 'growing', label: 'Growing' },
  { value: 'declining', label: 'Declining' },
  { value: 'at_risk', label: 'At Risk' },
  { value: 'new', label: 'New' },
];

const TIER_OPTIONS: { value: HoReCaTier | 'all'; label: string }[] = [
  { value: 'all', label: 'All Tiers' },
  { value: 'Gold', label: 'Gold' },
  { value: 'Silver', label: 'Silver' },
  { value: 'Bronze', label: 'Bronze' },
];

const ActionMenu: React.FC<{
  onAction: (action: string) => void;
  actions: { key: string; label: string; icon: React.ReactNode; danger?: boolean }[];
}> = ({ onAction, actions }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1.5 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer text-stone-400 hover:text-stone-600"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-stone-200 py-1 z-20 min-w-[150px]">
          {actions.map(a => (
            <button key={a.key}
              onClick={(e) => { e.stopPropagation(); onAction(a.key); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors cursor-pointer ${
                a.danger ? 'text-red-600 hover:bg-red-50' : 'text-stone-700 hover:bg-stone-50'
              }`}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const HoReCaListView: React.FC<HoReCaListViewProps> = ({
  hoReCas, orders, invoices, currentUser, visits = [],
  onAddHoReCa, onUpdateHoReCa, onDeleteHoReCa, onStartOrder, setVisits,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [segmentFilter, setSegmentFilter] = useState<HoReCaSegment | 'all'>('all');
  const [tierFilter, setTierFilter] = useState<HoReCaTier | 'all'>('all');
  const [selectedHoReCa, setSelectedHoReCa] = useState<HoReCa | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [hoReCaToEdit, setHoReCaToEdit] = useState<HoReCa | null>(null);
  const [hoReCaToDelete, setHoReCaToDelete] = useState<HoReCa | null>(null);
  const [visitHoReCaId, setVisitHoReCaId] = useState<number | null>(null);

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isManager = currentUser.role === UserRole.MANAGER;
  const isRep = currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP;

  // Compute insights for segment data
  const insightsMap = useMemo(() => {
    const insights = computeAllHoReCaInsights(orders, hoReCas);
    const map = new Map<number, typeof insights[0]>();
    insights.forEach(i => map.set(i.hoReCaId, i));
    return map;
  }, [orders, hoReCas]);

  // Outstanding per hoReCa
  const outstandingMap = useMemo(() => {
    const map = new Map<number, number>();
    hoReCas.forEach(h => {
      const o = getHoReCaOutstanding(h.id, h.name, invoices);
      if (o.totalOutstanding > 0) map.set(h.id, o.totalOutstanding);
    });
    return map;
  }, [hoReCas, invoices]);

  // Last order date per hoReCa
  const lastOrderMap = useMemo(() => {
    const map = new Map<number, string>();
    orders.forEach(o => {
      const current = map.get(o.hoReCa.id);
      if (!current || new Date(o.orderDate) > new Date(current)) {
        map.set(o.hoReCa.id, o.orderDate);
      }
    });
    return map;
  }, [orders]);

  // Filter
  const filtered = useMemo(() => {
    let list = [...hoReCas];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(h =>
        h.name.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q)
      );
    }

    if (segmentFilter !== 'all') {
      list = list.filter(h => {
        const insight = insightsMap.get(h.id);
        return insight?.segment === segmentFilter;
      });
    }

    if (tierFilter !== 'all') {
      list = list.filter(h => h.tier === tierFilter);
    }

    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [hoReCas, searchQuery, segmentFilter, tierFilter, insightsMap]);

  const tierColors: Record<string, string> = {
    Gold: 'bg-amber-50 text-amber-800 border-amber-200',
    Silver: 'bg-stone-100 text-stone-700 border-stone-300',
    Bronze: 'bg-orange-50 text-orange-800 border-orange-200',
  };

  const handleAction = (hoReCa: HoReCa, action: string) => {
    switch (action) {
      case 'edit': setHoReCaToEdit(hoReCa); break;
      case 'delete': setHoReCaToDelete(hoReCa); break;
      case 'order': onStartOrder?.(hoReCa.id); break;
      case 'visit': setVisitHoReCaId(hoReCa.id); break;
    }
  };

  const getActions = (hoReCa: HoReCa) => {
    const actions: { key: string; label: string; icon: React.ReactNode; danger?: boolean }[] = [];
    if (isRep && onStartOrder) actions.push({ key: 'order', label: 'Start Order', icon: <ShoppingBag className="w-3.5 h-3.5" /> });
    if (isRep && setVisits) actions.push({ key: 'visit', label: 'Log Visit', icon: <Building2 className="w-3.5 h-3.5" /> });
    if (isAdmin && onUpdateHoReCa) actions.push({ key: 'edit', label: 'Edit', icon: <Pencil className="w-3.5 h-3.5" /> });
    if (isAdmin && onDeleteHoReCa) actions.push({ key: 'delete', label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, danger: true });
    return actions;
  };

  // Profile view
  if (selectedHoReCa) {
    return (
      <HoReCaProfile
        hoReCa={selectedHoReCa}
        orders={orders}
        invoices={invoices}
        currentUser={currentUser}
        visits={visits}
        hoReCas={hoReCas}
        onBack={() => setSelectedHoReCa(null)}
        onUpdateHoReCa={onUpdateHoReCa}
        onStartOrder={onStartOrder}
        onLogVisit={setVisits ? () => setVisitHoReCaId(selectedHoReCa.id) : undefined}
        setVisits={setVisits}
      />
    );
  }

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">HoReCa Customers</h1>
          <p className="text-xs text-stone-500 mt-0.5">{hoReCas.length} customers</p>
        </div>
        {onAddHoReCa && (
          <button onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors cursor-pointer">
            <Plus className="w-4 h-4" /> Add HoReCa
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search by name or address..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <select
            value={tierFilter}
            onChange={e => setTierFilter(e.target.value as HoReCaTier | 'all')}
            className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 cursor-pointer"
          >
            {TIER_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* Segment Chips */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SEGMENT_OPTIONS.map(seg => (
            <button key={seg.value}
              onClick={() => setSegmentFilter(seg.value)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                segmentFilter === seg.value
                  ? 'bg-nexgen-blue text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {seg.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-stone-400">
        {filtered.length} {filtered.length === 1 ? 'customer' : 'customers'}
        {segmentFilter !== 'all' && ` (${segmentFilter.replace('_', ' ')})`}
        {tierFilter !== 'all' && ` - ${tierFilter}`}
      </p>

      {/* Table */}
      {filtered.length > 0 ? (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Customer</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Tier</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Segment</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider">Credit Limit</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Last Order</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider">Outstanding</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((h, idx) => {
                  const insight = insightsMap.get(h.id);
                  const outstanding = outstandingMap.get(h.id);
                  const lastOrder = lastOrderMap.get(h.id);
                  const actions = getActions(h);

                  return (
                    <tr key={h.id}
                      onClick={() => setSelectedHoReCa(h)}
                      className={`transition-colors hover:bg-stone-50/50 cursor-pointer ${idx < filtered.length - 1 ? 'border-b border-stone-100' : ''}`}
                    >
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-stone-900">{h.name}</p>
                        <p className="text-xs text-stone-400 mt-0.5 truncate max-w-[250px]">{h.address}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        {h.tier ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${tierColors[h.tier] ?? 'bg-stone-100 text-stone-600 border-stone-200'}`}>
                            {h.tier}
                          </span>
                        ) : (
                          <span className="text-xs text-stone-300">--</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {insight ? <SegmentBadge segment={insight.segment} /> : <span className="text-xs text-stone-300">--</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm tabular-nums text-stone-700">
                        {h.creditLimit ? `$${h.creditLimit.toLocaleString()}` : '--'}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-stone-600">
                        {lastOrder ? new Date(lastOrder).toLocaleDateString() : '--'}
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm tabular-nums">
                        {outstanding ? (
                          <span className="font-semibold text-amber-700">${outstanding.toFixed(2)}</span>
                        ) : (
                          <span className="text-stone-300">--</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {actions.length > 0 && <ActionMenu actions={actions} onAction={(a) => handleAction(h, a)} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-xl p-8 text-center">
          <Building2 className="w-8 h-8 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-stone-600">No customers match your filters</p>
          <p className="text-xs text-stone-400 mt-1">Try adjusting your search or filters</p>
        </div>
      )}

      {/* Add Form Modal */}
      {showAddForm && onAddHoReCa && (
        <HoReCaForm
          hoReCaToEdit={null}
          onSave={(data, reason) => { onAddHoReCa(data as Omit<HoReCa, 'id'>, reason); setShowAddForm(false); }}
          onClose={() => setShowAddForm(false)}
          userRole={currentUser.role}
        />
      )}

      {/* Edit Form Modal */}
      {hoReCaToEdit && onUpdateHoReCa && (
        <HoReCaForm
          hoReCaToEdit={hoReCaToEdit}
          onSave={(data, reason) => { onUpdateHoReCa(data as HoReCa, reason); setHoReCaToEdit(null); }}
          onClose={() => setHoReCaToEdit(null)}
          userRole={currentUser.role}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={hoReCaToDelete !== null && onDeleteHoReCa !== undefined}
        title="Delete HoReCa"
        message={hoReCaToDelete ? `Are you sure you want to delete "${hoReCaToDelete.name}"? This action cannot be undone.` : ''}
        onConfirm={() => { if (hoReCaToDelete && onDeleteHoReCa) { onDeleteHoReCa(hoReCaToDelete.id); } setHoReCaToDelete(null); }}
        onCancel={() => setHoReCaToDelete(null)}
      />

      {/* Visit Modal (Rep) */}
      {visitHoReCaId !== null && setVisits && (
        <VisitModal
          hoReCaId={visitHoReCaId}
          userId={currentUser.id}
          hoReCas={hoReCas}
          onSave={(visit) => { setVisits([...visits, visit]); setVisitHoReCaId(null); }}
          onClose={() => setVisitHoReCaId(null)}
        />
      )}
    </div>
  );
};

export default HoReCaListView;

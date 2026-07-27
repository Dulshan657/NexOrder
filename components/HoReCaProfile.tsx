import React, { useMemo, useState } from 'react';
import type { HoReCa, Order, Invoice, User, Visit } from '../types';
import { UserRole } from '../types';
import { ArrowLeft, MapPin, CreditCard, Percent, ShoppingBag, Pencil, Phone, Building2 } from 'lucide-react';
import SegmentBadge from './SegmentBadge';
import HoReCaInsightCard from './HoReCaInsightCard';
import OutstandingPayments from './OutstandingPayments';
import VisitHistory from './visits/VisitHistory';
import VisitModal from './visits/VisitModal';
import HoReCaForm from './HoReCaForm';
import { getHoReCaOutstanding } from '../services/accountingService';
import { computeAllHoReCaInsights } from '../services/buyingPatternsService';

interface HoReCaProfileProps {
  hoReCa: HoReCa;
  orders: Order[];
  invoices: Invoice[];
  currentUser: User;
  visits?: Visit[];
  hoReCas: HoReCa[];
  onBack: () => void;
  onUpdateHoReCa?: (customer: HoReCa, reason?: string) => void;
  onStartOrder?: (hoReCaId: number) => void;
  onLogVisit?: (hoReCaId: number) => void;
  setVisits?: (visits: Visit[]) => void;
}

const HoReCaProfile: React.FC<HoReCaProfileProps> = ({
  hoReCa, orders, invoices, currentUser, visits = [], hoReCas,
  onBack, onUpdateHoReCa, onStartOrder, onLogVisit, setVisits,
}) => {
  const [showEditForm, setShowEditForm] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);

  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isRep = currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP;

  const outstanding = useMemo(
    () => getHoReCaOutstanding(hoReCa.id, hoReCa.name, invoices),
    [hoReCa.id, hoReCa.name, invoices]
  );

  const insight = useMemo(() => {
    const insights = computeAllHoReCaInsights(orders, [hoReCa]);
    return insights[0] ?? null;
  }, [orders, hoReCa]);

  const recentOrders = useMemo(() => {
    return orders
      .filter(o => o.hoReCa.id === hoReCa.id)
      .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
      .slice(0, 10);
  }, [orders, hoReCa.id]);

  const tierColors: Record<string, string> = {
    Gold: 'bg-amber-50 text-amber-800 border-amber-200',
    Silver: 'bg-stone-100 text-stone-700 border-stone-300',
    Bronze: 'bg-orange-50 text-orange-800 border-orange-200',
  };

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-stone-600" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-display font-bold text-stone-900">{hoReCa.name}</h1>
              {hoReCa.tier && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${tierColors[hoReCa.tier] ?? 'bg-stone-100 text-stone-600 border-stone-200'}`}>
                  {hoReCa.tier}
                </span>
              )}
              {insight && <SegmentBadge segment={insight.segment} />}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-sm text-stone-500">
              <MapPin className="w-3.5 h-3.5" />
              {hoReCa.address}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && onUpdateHoReCa && (
            <button onClick={() => setShowEditForm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 transition-colors cursor-pointer">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {isRep && onLogVisit && (
            <button onClick={() => setShowVisitModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-nexgen-blue/10 text-nexgen-blue text-sm font-medium hover:bg-nexgen-blue/20 transition-colors cursor-pointer">
              <Building2 className="w-3.5 h-3.5" /> Log Visit
            </button>
          )}
          {isRep && onStartOrder && (
            <button onClick={() => onStartOrder(hoReCa.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors cursor-pointer">
              <ShoppingBag className="w-3.5 h-3.5" /> Start Order
            </button>
          )}
        </div>
      </div>

      {/* Key Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left — Contact & Financial */}
        <div className="glass-card rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-stone-900">Customer Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-stone-500 mb-1">
                <CreditCard className="w-3.5 h-3.5" /> Credit Limit
              </div>
              <p className="text-sm font-semibold text-stone-900">
                {hoReCa.creditLimit ? `$${hoReCa.creditLimit.toLocaleString()}` : 'No limit'}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-stone-500 mb-1">
                <Percent className="w-3.5 h-3.5" /> Discount
              </div>
              <p className="text-sm font-semibold text-stone-900">
                {hoReCa.discountPercent ? `${hoReCa.discountPercent}%` : 'None'}
              </p>
            </div>
          </div>

          {/* Payment Methods */}
          <div>
            <p className="text-xs text-stone-500 mb-2">Payment Methods</p>
            {hoReCa.paymentMethods && hoReCa.paymentMethods.length > 0 ? (
              <div className="space-y-1.5">
                {hoReCa.paymentMethods.map(pm => (
                  <div key={pm.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-stone-400" />
                      <span className="text-stone-700">{pm.type}</span>
                      <span className="text-stone-400">{pm.details}</span>
                    </div>
                    {pm.isDefault && (
                      <span className="text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-medium">Default</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-400">No payment methods configured</p>
            )}
          </div>
        </div>

        {/* Right — Outstanding Payments */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-900 mb-3">Outstanding Payments</h3>
          {outstanding.totalOutstanding > 0 ? (
            <OutstandingPayments data={outstanding} compact />
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-stone-400">No outstanding payments</p>
            </div>
          )}
        </div>
      </div>

      {/* Buying Patterns */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-stone-900 mb-3">Buying Patterns</h3>
        <HoReCaInsightCard customer={hoReCa} allOrders={orders} />
      </div>

      {/* Recent Orders */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200/50">
          <h3 className="text-sm font-semibold text-stone-900">Recent Orders</h3>
        </div>
        {recentOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Order ID</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Rep</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order, idx) => (
                  <tr key={order.id} className={`hover:bg-stone-50/50 transition-colors ${idx < recentOrders.length - 1 ? 'border-b border-stone-100' : ''}`}>
                    <td className="px-5 py-3 text-sm font-mono text-stone-600">{order.id.slice(0, 8)}</td>
                    <td className="px-5 py-3 text-sm text-stone-600">{new Date(order.orderDate).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                        order.status === 'delivered' ? 'bg-emerald-50 text-emerald-700' :
                        order.status === 'cancelled' ? 'bg-red-50 text-red-700' :
                        'bg-stone-100 text-stone-600'
                      }`}>
                        {order.status ?? 'Pending'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-stone-600">{order.submittedBy.name}</td>
                    <td className="px-5 py-3 text-sm text-right font-semibold text-stone-900 tabular-nums">${order.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center">
            <p className="text-sm text-stone-400">No orders yet</p>
          </div>
        )}
      </div>

      {/* Visit History */}
      {visits && visits.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-900 mb-3">Visit History</h3>
          <VisitHistory visits={visits} hoReCas={hoReCas} filterHoReCaId={hoReCa.id} />
        </div>
      )}

      {/* Edit Form Modal (Admin) */}
      {showEditForm && onUpdateHoReCa && (
        <HoReCaForm
          hoReCaToEdit={hoReCa}
          onSave={(updated, reason) => { onUpdateHoReCa(updated as HoReCa, reason); setShowEditForm(false); }}
          onClose={() => setShowEditForm(false)}
          userRole={currentUser.role}
        />
      )}

      {/* Visit Modal (Rep) */}
      {showVisitModal && setVisits && (
        <VisitModal
          hoReCaId={hoReCa.id}
          userId={currentUser.id}
          hoReCas={hoReCas}
          onSave={(visit) => { setVisits([...visits, visit]); setShowVisitModal(false); }}
          onClose={() => setShowVisitModal(false)}
        />
      )}
    </div>
  );
};

export default HoReCaProfile;

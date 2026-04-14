import React, { useMemo } from 'react';
import type { OrderItem, HoReCa, User, DeliveryTimeSlot, Invoice, Promotion, Product } from '../types';
import { UserRole } from '../types';
import DeliveryScheduler from './DeliveryScheduler';
import OutstandingPayments from './OutstandingPayments';
import { getHoReCaOutstanding } from '../services/accountingService';
import { applyCartPromotions } from '../services/promotionService';

interface OrderSummaryProps {
  items: OrderItem[];
  total: number;
  currentUser: User;
  userRole: UserRole;
  hoReCas: HoReCa[];
  selectedHoReCaId: number | null;
  notes: string;
  deliveryDate: string;
  deliveryTimeSlot: DeliveryTimeSlot | '';
  onSelectHoReCa: (hoReCaId: number) => void;
  onUpdateQuantity: (productId: number, newQuantity: number, packSize?: number) => void;
  onSubmitOrder: () => void;
  onNotesChange: (notes: string) => void;
  onDeliveryDateChange: (date: string) => void;
  onDeliveryTimeSlotChange: (slot: DeliveryTimeSlot) => void;
  isLoading: boolean;
  errors: {
    customer?: string;
    emptyOrder?: string;
    api?: string;
  };
  onClose?: () => void;
  invoices?: Invoice[];
  isAdminOrManager?: boolean;
  promotions?: Promotion[];
  products?: Product[];
  hideHoReCaSelector?: boolean;
}

const OrderSummary: React.FC<OrderSummaryProps> = ({
  items,
  total,
  currentUser,
  userRole,
  hoReCas,
  selectedHoReCaId,
  notes,
  deliveryDate,
  deliveryTimeSlot,
  onSelectHoReCa,
  onUpdateQuantity,
  onSubmitOrder,
  onNotesChange,
  onDeliveryDateChange,
  onDeliveryTimeSlotChange,
  isLoading,
  errors,
  onClose,
  invoices = [],
  isAdminOrManager = false,
  promotions = [],
  products = [],
  hideHoReCaSelector = false,
}) => {
  const apiError = errors.api;

  const hoReCaOutstanding = useMemo(() => {
    const customer = hoReCas.find(c => c.id === selectedHoReCaId);
    if (!customer || invoices.length === 0) return null;
    const data = getHoReCaOutstanding(customer.id, customer.name, invoices);
    return data.totalOutstanding > 0 ? data : null;
  }, [hoReCas, selectedHoReCaId, invoices]);

  const selectedHoReCa = hoReCas.find(c => c.id === selectedHoReCaId);

  const cartPromos = useMemo(() => {
    if (promotions.length === 0 || items.length === 0) return null;
    const result = applyCartPromotions(items, promotions, selectedHoReCa ?? null, currentUser, products);
    return (result.bogoFreeItems.length > 0 || result.bundleDiscounts.length > 0) ? result : null;
  }, [items, promotions, selectedHoReCa, currentUser, products]);

  const adjustedTotal = cartPromos ? Math.max(total - cartPromos.totalDiscount, 0) : total;

  const handleRemoveOrDecrement = (productId: number, newQuantity: number, packSize?: number) => {
    if (!cartPromos) {
      onUpdateQuantity(productId, newQuantity, packSize);
      return;
    }
    // Find any BOGO promo whose trigger would be invalidated by this change.
    const affected = cartPromos.bogoFreeItems.find(b => {
      if (b.triggerProductId !== productId) return false;
      const currentBuyQty = items
        .filter(i => i.id === productId)
        .reduce((s, i) => s + i.quantity, 0);
      // Simulate: remove (currentQty - newQuantity) from this line's packSize group.
      const thisLine = items.find(i => i.id === productId && i.packSize === packSize);
      if (!thisLine) return false;
      const delta = thisLine.quantity - Math.max(newQuantity, 0);
      const afterQty = currentBuyQty - delta;
      return afterQty < b.triggerQuantityRequired;
    });
    if (affected) {
      const ok = window.confirm(`Removing this item will cancel promo "${affected.promoName}". Continue?`);
      if (!ok) return;
    }
    onUpdateQuantity(productId, newQuantity, packSize);
  };

  const creditLimit = selectedHoReCa?.creditLimit;
  const remainingCredit = creditLimit !== undefined ? creditLimit - adjustedTotal : undefined;
  const isOverLimit = remainingCredit !== undefined && remainingCredit < 0;

  return (
    <div className={`bg-white ${onClose ? 'h-full flex flex-col bg-stone-50' : 'p-6 rounded-xl shadow-card border border-stone-200/60'}`}>
      {/* Modal Header for mobile view */}
      {onClose && (
        <div className="flex items-center justify-between p-5 border-b border-stone-200 bg-white flex-shrink-0">
          <h2 className="text-xl font-display font-bold text-stone-900">Your Order</h2>
          <button onClick={onClose} className="p-2 text-stone-500 hover:text-stone-900 rounded-full hover:bg-stone-100 transition-colors">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className={` ${onClose ? 'flex-grow overflow-y-auto p-4' : ''}`}>
        {!onClose && <h2 className="text-2xl font-display font-bold text-stone-900 tracking-tight mb-5 border-b border-stone-100 pb-4">Order Summary</h2>}
        
        <div className={onClose ? 'bg-white p-5 rounded-xl shadow-sm border border-stone-200' : ''}>
            {!hideHoReCaSelector && (userRole === UserRole.FIELD_REP || userRole === UserRole.OFFICE_REP) && (
              <div className="mb-5">
                <label htmlFor="customer" className="block text-sm font-medium text-stone-700 mb-1.5">HoReCa</label>
                <select id="customer" value={selectedHoReCaId ?? ''} onChange={(e) => onSelectHoReCa(Number(e.target.value))} className={`block w-full rounded-lg border-0 bg-stone-50 py-3 px-4 text-stone-900 shadow-sm ring-1 ring-inset sm:text-sm transition-all ${errors.hoReCa ? 'ring-red-500 focus:ring-red-600' : 'ring-stone-200 focus:ring-emerald-600 hover:ring-stone-300'} focus:ring-2`} aria-invalid={!!errors.hoReCa}>
                  <option value="" disabled>Select a HoReCa</option>
                  {hoReCas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {errors.hoReCa && <p className="text-red-500 text-xs mt-1.5">{errors.hoReCa}</p>}
              </div>
            )}

            {!hideHoReCaSelector && userRole === UserRole.CUSTOMER && (
                <div className="mb-5">
                    <label className="block text-sm font-medium text-stone-500 uppercase tracking-wider">Ordering For</label>
                    <p className="mt-1.5 text-lg font-semibold text-stone-900 bg-stone-50 p-3.5 rounded-lg border border-stone-100">
                        {hoReCas.find(c => c.id === currentUser.hoReCaId)?.name || 'Unknown HoReCa'}
                    </p>
                </div>
            )}

            {/* Outstanding Payments Warning */}
            {hoReCaOutstanding && (
              <div className="mb-4">
                <OutstandingPayments data={hoReCaOutstanding} compact />
                {hoReCaOutstanding.isBlocked && isAdminOrManager && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mt-2">
                    Admin/Manager override available — you can still place this order.
                  </p>
                )}
              </div>
            )}

            <div className={`${onClose ? '' : 'max-h-64 overflow-y-auto pr-2 -mr-2'}`}>
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10">
                    {errors.emptyOrder ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-red-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <p className="text-red-600 font-semibold">{errors.emptyOrder}</p>
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-stone-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <p className="text-stone-500 font-medium">Your order is empty.</p>
                        <p className="text-sm text-stone-400 mt-1">Add products to get started.</p>
                      </>
                    )}
                </div>
              ) : (
                <div className="divide-y divide-stone-100">
                {items.map(item => (
                  <div key={`${item.id}-${item.packSize}`} className="flex items-start justify-between py-3.5">
                    <div className="flex-grow pr-4">
                        <p className="font-medium text-stone-900">{item.name}</p>
                        <p className="text-xs text-stone-400 mb-0.5">SKU: {item.sku}</p>
                        <p className="text-sm text-stone-500">${item.price.toFixed(2)} / {item.unit}</p>
                    </div>
                    <div className="flex flex-col items-end space-y-2 flex-shrink-0">
                        <div className="flex items-center space-x-3">
                            <div className="flex items-center border border-stone-200 rounded-lg shadow-sm divide-x divide-stone-200 overflow-hidden">
                                <button onClick={() => handleRemoveOrDecrement(item.id, item.quantity - 1, item.packSize)} className="px-2.5 py-1.5 text-stone-600 hover:bg-stone-50 bg-white transition-colors disabled:opacity-50" aria-label={`Decrease quantity for ${item.name}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" /></svg>
                                </button>
                                <span className="px-3 py-1.5 text-center font-medium text-stone-900 text-sm bg-stone-50 w-12" aria-live="polite">{item.quantity}</span>
                                <button onClick={() => onUpdateQuantity(item.id, item.quantity + 1, item.packSize)} className="px-2.5 py-1.5 text-stone-600 hover:bg-stone-50 bg-white transition-colors" aria-label={`Increase quantity for ${item.name}`}>
                                     <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                                </button>
                            </div>
                            <button onClick={() => handleRemoveOrDecrement(item.id, 0, item.packSize)} className="text-stone-400 hover:text-red-600 hover:bg-red-50 p-2.5 -m-1 rounded-full transition-colors duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500" aria-label={`Remove ${item.name} from order`}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg>
                            </button>
                        </div>
                        <p className="text-sm font-semibold text-stone-900 pr-10 tabular-nums">${(item.price * item.quantity).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
                </div>
              )}
            </div>
             {items.length > 0 && (
                <div className="mt-5 pt-5 border-t border-stone-100">
                    <label htmlFor="order-notes" className="block text-sm font-medium text-stone-700 mb-1.5">Optional Order Notes</label>
                    <textarea
                        id="order-notes"
                        rows={3}
                        value={notes}
                        onChange={(e) => onNotesChange(e.target.value)}
                        className="block w-full rounded-lg border-0 bg-stone-50 py-3 px-4 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300"
                        placeholder="Add any special instructions for the warehouse..."
                    ></textarea>
                    <DeliveryScheduler
                        deliveryDate={deliveryDate}
                        deliveryTimeSlot={deliveryTimeSlot}
                        onDateChange={onDeliveryDateChange}
                        onTimeSlotChange={onDeliveryTimeSlotChange}
                    />
                </div>
            )}
        </div>
      </div>

      {/* Modal Footer for mobile view */}
      <div className={`mt-auto ${onClose ? 'p-5 border-t border-stone-200 bg-white flex-shrink-0' : 'mt-6 border-t border-stone-100 pt-5'}`}>
        {creditLimit !== undefined && (
          <div className="mb-4 space-y-2 border-b border-stone-100 pb-4">
            <div className="flex justify-between items-center text-sm text-stone-600">
              <span>Credit Limit:</span>
              <span className="font-medium">${creditLimit.toFixed(2)}</span>
            </div>
            <div className={`flex justify-between items-center text-sm ${isOverLimit ? 'text-red-600 font-semibold' : 'text-stone-600'}`}>
              <span>Remaining Credit:</span>
              <span>${remainingCredit.toFixed(2)}</span>
            </div>
          </div>
        )}
        {cartPromos && (
          <div className="mb-3 space-y-1.5 border-b border-stone-100 pb-3">
            <div className="flex justify-between items-center text-sm text-stone-600">
              <span>Subtotal:</span>
              <span>${total.toFixed(2)}</span>
            </div>
            {cartPromos.bogoFreeItems.map(item => (
              <div key={item.promoId} className="flex justify-between items-center text-sm text-purple-700">
                <span className="flex items-center gap-1 truncate mr-2">
                  <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">FREE</span>
                  <span className="truncate">+{item.freeQuantity} {item.productName} <span className="text-stone-400">({item.unit})</span></span>
                </span>
                <span className="tabular-nums">$0.00</span>
              </div>
            ))}
            {cartPromos.bundleDiscounts.map(bundle => (
              <div key={bundle.promoId} className="flex justify-between items-center text-sm text-indigo-700">
                <span className="truncate mr-2">{bundle.promoName}</span>
                <span>-${bundle.discount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between items-center text-xl font-display font-bold text-stone-900 tracking-tight">
          <span>Total:</span>
          <span className="tabular-nums">${adjustedTotal.toFixed(2)}</span>
        </div>
        {items.length > 0 && (() => {
          const totalVolume = items.reduce((sum, item) => {
            const isCarton = item.packSize != null && item.packSize > 1;
            const vol = isCarton
              ? (item.cubicMetersCarton ?? (item.cubicMetersUnit != null ? item.cubicMetersUnit * item.packSize! : 0))
              : (item.cubicMetersUnit ?? 0);
            return sum + vol * item.quantity;
          }, 0);
          if (totalVolume <= 0) return null;
          return (
            <div className="flex justify-between items-center text-sm text-stone-500 mt-2">
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  <path d="M8 15V8M8 8L2 4.5M8 8L14 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                </svg>
                Total Volume:
              </span>
              <span className="font-medium text-stone-700">{totalVolume.toFixed(4)} m³</span>
            </div>
          );
        })()}
        {apiError && <p className="text-red-500 text-sm mt-4 text-center">{apiError}</p>}
        {isOverLimit && <p className="text-red-500 text-sm mt-2 text-center font-medium">Order exceeds available credit limit.</p>}
        <button
          onClick={onSubmitOrder}
          disabled={isLoading || items.length === 0 || isOverLimit || (hoReCaOutstanding?.isBlocked && !isAdminOrManager)}
          className="w-full mt-6 bg-nexgen-blue text-white font-medium py-3.5 rounded-lg hover:bg-nexgen-blue-dark disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed flex items-center justify-center shadow-card btn-press cursor-pointer"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              Submitting...
            </>
          ) : 'Submit Order'}
        </button>
      </div>
    </div>
  );
};

export default OrderSummary;
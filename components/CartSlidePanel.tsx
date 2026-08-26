import React from 'react';
import type { OrderItem, User, HoReCa, DeliveryTimeSlot, Invoice, Promotion, Product } from '../types';
import { UserRole } from '../types';
import OrderSummary from './OrderSummary';
import { X, ShoppingCart } from 'lucide-react';
import AnimatedIcon from './AnimatedIcon';

interface CartSlidePanelProps {
  isOpen: boolean;
  onClose: () => void;
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
  errors: { hoReCa?: string; emptyOrder?: string; api?: string };
  invoices: Invoice[];
  isAdminOrManager: boolean;
  promotions: Promotion[];
  products: Product[];
}

const CartSlidePanel: React.FC<CartSlidePanelProps> = ({
  isOpen,
  onClose,
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
  invoices,
  isAdminOrManager,
  promotions,
  products,
}) => {
  return (
    <aside
      className={`hidden lg:flex flex-col fixed top-0 right-0 h-svh w-[420px] bg-white border-l border-stone-200 shadow-elevated z-40 transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <AnimatedIcon icon={ShoppingCart} animation="bounce" className="w-5 h-5 text-stone-700" />
          <h2 className="text-lg font-display font-bold text-stone-900 tracking-tight">Your Order</h2>
          {items.length > 0 && (
            <span className="bg-nexgen-blue/10 text-nexgen-blue text-xs font-semibold px-2 py-0.5 rounded-full">
              {items.reduce((sum, i) => sum + i.quantity, 0)} items
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
          aria-label="Close cart"
        >
          <AnimatedIcon icon={X} animation="pop" className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable order summary */}
      <div className="flex-1 overflow-y-auto">
        <OrderSummary
          items={items}
          total={total}
          currentUser={currentUser}
          userRole={userRole}
          hoReCas={hoReCas}
          selectedHoReCaId={selectedHoReCaId}
          notes={notes}
          deliveryDate={deliveryDate}
          deliveryTimeSlot={deliveryTimeSlot}
          onSelectHoReCa={onSelectHoReCa}
          onUpdateQuantity={onUpdateQuantity}
          onSubmitOrder={onSubmitOrder}
          onNotesChange={onNotesChange}
          onDeliveryDateChange={onDeliveryDateChange}
          onDeliveryTimeSlotChange={onDeliveryTimeSlotChange}
          isLoading={isLoading}
          errors={errors}
          invoices={invoices}
          isAdminOrManager={isAdminOrManager}
          promotions={promotions}
          products={products}
          hideHoReCaSelector
        />
      </div>
    </aside>
  );
};

export default CartSlidePanel;

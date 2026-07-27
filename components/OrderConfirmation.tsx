import React from 'react';
import type { Order } from '../types';
import StatusBadge from './StatusBadge';
import { Truck, Calendar } from 'lucide-react';
import { Modal, Button } from './ui';

interface OrderConfirmationProps {
  order: Order;
  confirmationMessage: string;
  onClose: () => void;
}

const OrderConfirmation: React.FC<OrderConfirmationProps> = ({ order, confirmationMessage, onClose }) => {
  return (
    // No title: the celebratory tick + heading are the point of this screen and
    // would read oddly compressed into the chrome header. Backdrop dismissal
    // stays off — "Start New Order" resets the cart, so it must be deliberate.
    <Modal
      open
      onClose={onClose}
      size="3xl"
      dismissOnBackdrop={false}
      footer={
        <Button onClick={onClose} className="w-full sm:w-auto">
          Start New Order
        </Button>
      }
    >
      <div className="text-center">
        <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-nexgen-blue-light mb-6 border-4 border-blue-200">
            <svg className="h-10 w-10 text-nexgen-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
        </div>
        <h2 className="text-3xl font-display font-bold text-stone-900 tracking-tight text-balance">Order Submitted Successfully</h2>

        {/* OrderStream notice */}
        <div className="flex items-center justify-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mt-4 mx-auto max-w-md">
            <Truck className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <p className="text-sm text-blue-700">{confirmationMessage}</p>
        </div>

        <div className="mt-6 text-left border-t border-stone-200 pt-6">
          <h4 className="text-lg font-display font-semibold text-stone-900">Order Details:</h4>
          <div className="mt-4 space-y-3 text-stone-600">
              <p><strong className="text-stone-800">Order ID:</strong> {order.id}</p>
              <p><strong className="text-stone-800">HoReCa:</strong> {order.hoReCa.name}</p>
              <p><strong className="text-stone-800">Total:</strong> <span className="font-bold text-emerald-700">${order.total.toFixed(2)}</span></p>
              <p><strong className="text-stone-800">Submitted By:</strong> {order.submittedBy.name} <span className="text-stone-500">({order.submittedBy.role})</span></p>
              <div className="flex items-center gap-2">
                  <strong className="text-stone-800">Status:</strong>
                  <StatusBadge status={order.status} />
              </div>
              {order.deliveryDate && (
                  <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-stone-500" />
                      <span>
                          <strong className="text-stone-800">Delivery:</strong>{' '}
                          {new Date(order.deliveryDate + 'T00:00:00').toLocaleDateString('en-AU', { dateStyle: 'long' })}
                          {order.deliveryTimeSlot && ` — ${order.deliveryTimeSlot}`}
                      </span>
                  </div>
              )}
              {order.notes && (
                <p><strong className="text-stone-800">Notes:</strong> {order.notes}</p>
              )}
          </div>
        </div>

        <p className="text-sm text-stone-500 mt-6">You can track your order status in Order History.</p>
      </div>
    </Modal>
  );
};

export default OrderConfirmation;

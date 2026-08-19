import React, { useState } from 'react';
import type { Order, OrderStatus, User, Invoice, InvoicePaymentAction } from '../types';
import { UserRole } from '../types';
import { ORDER_STATUS_SEQUENCE } from '../constants';
import StatusBadge from './StatusBadge';
import StatusTimeline from './StatusTimeline';
import PaymentStatusBadge from './PaymentStatusBadge';
import PaymentActionModal from './PaymentActionModal';
import CancelOrderModal from './CancelOrderModal';
import OrderSourceBadge from './OrderSourceBadge';
import OrderFulfillmentsPanel from './OrderFulfillmentsPanel';
import { getInboundApproval } from '../lib/orderSource';
import { orderDeliveryAddress } from '../lib/orderDeliveryAddress';
import { useUpdateInvoiceStatus } from '../hooks/queries/useInvoices';
import { useCancelOrder, useOrderPickedUnits } from '../hooks/queries/useOrders';
import { cancelUnavailableReason } from '../lib/orderCancel';
import { useToasts } from '../hooks/useToasts';
import { Modal } from './ui';
import { Package, Truck, Calendar, FileText, Ban } from 'lucide-react';

interface OrderDetailViewProps {
    order: Order;
    currentUser: User;
    invoice?: Invoice;
    onUpdateStatus?: (orderId: string, newStatus: OrderStatus, note?: string, opts?: { locationId?: number; locationPref?: number[] }) => void;
    onClose: () => void;
}

const OrderDetailView: React.FC<OrderDetailViewProps> = ({ order, currentUser, invoice, onUpdateStatus, onClose }) => {
    const [statusNote, setStatusNote] = useState('');
    const deliveryAddress = orderDeliveryAddress(order);
    const isAdmin = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER;
    const isManager = currentUser.role === UserRole.MANAGER;

    const updateInvoiceStatus = useUpdateInvoiceStatus();
    const { addToast } = useToasts();
    const [paymentAction, setPaymentAction] = useState<InvoicePaymentAction | null>(null);
    const [paymentError, setPaymentError] = useState<string | undefined>(undefined);

    const submitPaymentAction = (reason?: string) => {
        if (!paymentAction) return;
        setPaymentError(undefined);
        updateInvoiceStatus.mutate(
            { orderId: order.id, status: paymentAction, reason },
            {
                onSuccess: () => {
                    addToast(`Order ${order.id} marked as ${paymentAction}`, 'success');
                    setPaymentAction(null);
                },
                onError: (err) => {
                    setPaymentError(err instanceof Error ? err.message : 'Failed to update payment status');
                },
            },
        );
    };

    // ORDER_STATUS_SEQUENCE is the six-rung ladder and 'cancelled' is NOT on it
    // (mig 00111), so indexOf returns -1 for a cancelled order and `currentIdx + 1`
    // would resolve to 'processing' -- offering to advance an order that has been
    // voided. Guarding on the index rather than on the status keeps the rule where
    // the arithmetic is.
    const currentIdx = ORDER_STATUS_SEQUENCE.indexOf(order.status);
    const nextStatus =
        currentIdx >= 0 && currentIdx < ORDER_STATUS_SEQUENCE.length - 1
            ? ORDER_STATUS_SEQUENCE[currentIdx + 1]
            : null;

    // ── Cancellation ──────────────────────────────────────────────────────────
    // Admin only, and only while the order can still be cancelled. cancelBlocker
    // in lib/orderCancel.ts is the SAME module the Edge Function runs, so the
    // tooltip below is the refusal the server would give, not a guess at it.
    const isAdminOnly = currentUser.role === UserRole.ADMIN;
    const cancelMutation = useCancelOrder();
    const [cancelOpen, setCancelOpen] = useState(false);
    const [cancelError, setCancelError] = useState<string | undefined>(undefined);

    // Only asked when someone could actually act on the answer. While it loads,
    // pickedUnits is unknown -- treated as "not yet cancellable" rather than as
    // zero, because zero is the answer that would wrongly enable the button.
    const pickedQuery = useOrderPickedUnits(order.id, isAdminOnly);
    const pickedUnitsKnown = isAdminOnly && pickedQuery.isSuccess;
    const cancelBlockedBy = pickedUnitsKnown
        ? cancelUnavailableReason(order, invoice, currentUser.role, pickedQuery.data ?? 0)
        : null;
    // A blocker whose code is NOT_CANCELLABLE / ALREADY_CANCELLED means this
    // order is simply past the point of cancelling; there is nothing useful to
    // show and the control is hidden entirely. Everything else is a state the
    // operator might fix, so the button stays visible and explains itself.
    const cancelSectionVisible =
        isAdminOnly &&
        order.status !== 'cancelled' &&
        cancelBlockedBy?.code !== 'NOT_CANCELLABLE' &&
        cancelBlockedBy?.code !== 'FORBIDDEN';

    const submitCancel = (reason: string) => {
        setCancelError(undefined);
        cancelMutation.mutate(
            { id: order.id, reason },
            {
                onSuccess: () => {
                    addToast(`Order ${order.id} cancelled`, 'success');
                    setCancelOpen(false);
                },
                onError: (err) => {
                    setCancelError(err instanceof Error ? err.message : 'Failed to cancel the order');
                },
            },
        );
    };

    const handleAdvanceStatus = () => {
        if (nextStatus && onUpdateStatus) {
            onUpdateStatus(order.id, nextStatus, statusNote || undefined);
            setStatusNote('');
        }
    };

    return (
        <>
            <Modal
                open
                onClose={onClose}
                size="3xl"
                // A display surface with inline actions rather than a form, so there is
                // no `dirty` baseline to guard — the one editable field (the optional
                // status note) is consumed immediately by its own button. Without the
                // guard, backdrop dismissal stays off, matching the old behaviour where
                // only the X closed this.
                dismissOnBackdrop={false}
                title={`Order ${order.id}`}
                description={new Date(order.orderDate).toLocaleDateString('en-AU', { dateStyle: 'long' })}
            >
                <div className="space-y-6">
                    {/* Status badges. They sat beside the old hand-rolled close button;
                        DialogChrome's header is title + close only, so they lead the body. */}
                    <div className="flex flex-wrap items-center gap-3">
                        <OrderSourceBadge order={order} />
                        <StatusBadge status={order.status} size="md" />
                        <PaymentStatusBadge invoice={invoice} />
                    </div>

                    {/* OrderStream notice */}
                    <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                        <Truck className="w-5 h-5 text-blue-600 flex-shrink-0" />
                        <p className="text-sm text-blue-700">This order is managed via <strong>OrderStream</strong> for fulfillment and delivery tracking.</p>
                    </div>

                    {/* Order Info Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-stone-50 rounded-lg p-3">
                            <p className="text-xs text-stone-500 uppercase tracking-wider">HoReCa</p>
                            <p className="text-sm font-semibold text-stone-900 mt-1">{order.hoReCa.name}</p>
                        </div>
                        <div className="bg-stone-50 rounded-lg p-3">
                            <p className="text-xs text-stone-500 uppercase tracking-wider">Total</p>
                            <p className="text-sm font-semibold text-emerald-700 mt-1">${order.total.toFixed(2)}</p>
                        </div>
                        <div className="bg-stone-50 rounded-lg p-3">
                            {(() => {
                                const approval = getInboundApproval(order);
                                if (approval) {
                                    return (
                                        <>
                                            <p className="text-xs text-stone-500 uppercase tracking-wider">Approved By</p>
                                            <p className="text-sm font-semibold text-stone-900 mt-1">
                                                {approval.auto ? 'Auto-approved (system)' : (approval.name ?? 'Unknown')}
                                            </p>
                                        </>
                                    );
                                }
                                return (
                                    <>
                                        <p className="text-xs text-stone-500 uppercase tracking-wider">Submitted By</p>
                                        <p className="text-sm font-semibold text-stone-900 mt-1">{order.submittedBy.name}</p>
                                    </>
                                );
                            })()}
                        </div>
                        <div className="bg-stone-50 rounded-lg p-3">
                            <p className="text-xs text-stone-500 uppercase tracking-wider">Items</p>
                            <p className="text-sm font-semibold text-stone-900 mt-1">{order.items.length} products</p>
                        </div>
                    </div>

                    {/* Delivery Info */}
                    {order.deliveryDate && (
                        <div className="flex items-center gap-3 bg-stone-50 rounded-xl px-4 py-3">
                            <Calendar className="w-5 h-5 text-stone-500 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-stone-900">
                                    Scheduled Delivery: {new Date(order.deliveryDate + 'T00:00:00').toLocaleDateString('en-AU', { dateStyle: 'long' })}
                                </p>
                                {order.deliveryTimeSlot && (
                                    <p className="text-xs text-stone-500">{order.deliveryTimeSlot}</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Status Timeline */}
                    <div>
                        <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-3">Order Status</h3>
                        <StatusTimeline statusHistory={order.statusHistory} currentStatus={order.status} />
                    </div>

                    {/* Per-warehouse fulfilments (multi-warehouse orders) */}
                    <OrderFulfillmentsPanel
                        order={order}
                        canAdvanceAll={isAdmin}
                        homeWarehouseId={currentUser.homeWarehouseId}
                        onAdvance={
                            onUpdateStatus
                                ? (orderId, nextS, locationId) => onUpdateStatus(orderId, nextS, undefined, { locationId })
                                : undefined
                        }
                    />

                    {/* Admin status update */}
                    {isAdmin && nextStatus && onUpdateStatus && (
                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                            <h3 className="text-sm font-semibold text-stone-700 mb-3">Update Status</h3>
                            <div className="flex items-end gap-3">
                                <div className="flex-1">
                                    <label className="block text-xs text-stone-500 mb-1">Optional note</label>
                                    <input
                                        type="text"
                                        value={statusNote}
                                        onChange={e => setStatusNote(e.target.value)}
                                        placeholder="Add a note about this status change..."
                                        className="w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                                <button
                                    onClick={handleAdvanceStatus}
                                    className="px-4 py-2 bg-stone-900 text-white text-sm font-medium rounded-lg hover:bg-stone-800 transition-colors cursor-pointer whitespace-nowrap"
                                >
                                    Mark as {nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Cancel order — Admin only. Sits after Update Status because
                        it is the exception, not the routine action, and above the
                        invoice because cancelling takes the invoice with it. */}
                    {cancelSectionVisible && (
                        <div className="bg-rose-50/60 rounded-xl p-4 border border-rose-200">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div className="min-w-0">
                                    <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
                                        <Ban className="w-4 h-4 text-rose-600" />
                                        Cancel order
                                    </h3>
                                    <p className="text-xs text-stone-600 mt-1 max-w-prose">
                                        {cancelBlockedBy
                                            ? cancelBlockedBy.message
                                            : 'Releases the reserved stock, cancels the unpaid invoice and marks the order Cancelled. The order itself is kept.'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => { setCancelError(undefined); setCancelOpen(true); }}
                                    disabled={Boolean(cancelBlockedBy) || !pickedUnitsKnown}
                                    title={cancelBlockedBy?.message ?? undefined}
                                    className="px-4 py-2 bg-white border border-rose-300 text-rose-700 text-sm font-medium rounded-lg hover:bg-rose-50 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Cancel order
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Why this order was cancelled. The reason is the record, so it
                        belongs on the order, not only in the Admin-only audit log. */}
                    {order.status === 'cancelled' && (
                        <div className="bg-stone-100 rounded-xl p-4 border border-stone-300">
                            <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
                                <Ban className="w-4 h-4 text-stone-500" />
                                Cancelled
                            </h3>
                            {order.cancelReason && (
                                <p className="text-sm text-stone-700 mt-1">{order.cancelReason}</p>
                            )}
                            {order.cancelledAt && (
                                <p className="text-xs text-stone-500 mt-1">
                                    {new Date(order.cancelledAt).toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' })}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Invoice Section */}
                    {invoice && (
                        <div className="border border-stone-200 rounded-xl p-4">
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-stone-500" />
                                    <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">Invoice</h3>
                                </div>
                                <PaymentStatusBadge invoice={invoice} />
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                <div>
                                    <p className="text-xs text-stone-500">Invoice ID</p>
                                    <p className="font-medium text-stone-900">{invoice.id}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-stone-500">Amount</p>
                                    <p className="font-medium text-stone-900">${invoice.amount.toFixed(2)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-stone-500">Due Date</p>
                                    <p className="font-medium text-stone-900">{new Date(invoice.dueDate).toLocaleDateString('en-AU')}</p>
                                </div>
                                {invoice.paidDate && (
                                    <div>
                                        <p className="text-xs text-stone-500">Paid Date</p>
                                        <p className="font-medium text-stone-900">{new Date(invoice.paidDate).toLocaleDateString('en-AU')}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Admin/Manager: payment status actions (works whether or not an invoice exists) */}
                    {isAdmin && (
                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                            <h3 className="text-sm font-semibold text-stone-700 mb-3">Payment Status</h3>
                            <p className="text-xs text-stone-500 mb-3">
                                {invoice
                                    ? 'Mark this invoice as paid, overdue, or pending. Actions are audit-logged.'
                                    : 'No invoice on this order yet. Marking it paid or overdue will create one (Net-30 default).'}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Diagnostic — remove once payment-modal flow is confirmed working live.
                                        console.debug('[payment-action] open (OrderDetailView)', order.id, 'paid');
                                        setPaymentError(undefined);
                                        setPaymentAction('paid');
                                    }}
                                    disabled={invoice?.status === 'paid'}
                                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Mark Paid
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        console.debug('[payment-action] open (OrderDetailView)', order.id, 'overdue');
                                        setPaymentError(undefined);
                                        setPaymentAction('overdue');
                                    }}
                                    disabled={invoice?.status === 'overdue'}
                                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Mark Overdue
                                </button>
                                {invoice && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            console.debug('[payment-action] open (OrderDetailView)', order.id, 'pending');
                                            setPaymentError(undefined);
                                            setPaymentAction('pending');
                                        }}
                                        disabled={invoice.status === 'pending'}
                                        className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Mark Pending
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Order Items */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Package className="w-4 h-4 text-stone-500" />
                            <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">Items</h3>
                        </div>
                        <div className="border border-stone-200 rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-stone-50">
                                    <tr>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase">Product</th>
                                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase">Price</th>
                                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase">Qty</th>
                                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase">Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {order.items.map((item, i) => (
                                        <tr key={i}>
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-stone-900">{item.name}</p>
                                                <p className="text-xs text-stone-400">{item.sku} &middot; {item.unit}</p>
                                            </td>
                                            <td className="px-4 py-3 text-right text-stone-700">${item.price.toFixed(2)}</td>
                                            <td className="px-4 py-3 text-right text-stone-700">{item.quantity}</td>
                                            <td className="px-4 py-3 text-right font-medium text-stone-900">${(item.price * item.quantity).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-stone-50">
                                    <tr>
                                        <td colSpan={3} className="px-4 py-3 text-right font-semibold text-stone-700">Total</td>
                                        <td className="px-4 py-3 text-right font-bold text-stone-900">${order.total.toFixed(2)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Delivery address — the order's own snapshot when it has one,
                        otherwise the customer's standing address. Labelled either way,
                        so "this went to head office" is visible rather than inferred. */}
                    {deliveryAddress && (
                        <div className="bg-stone-50 rounded-xl p-4">
                            <p className="text-xs text-stone-500 uppercase tracking-wider mb-1">
                                Delivery Address
                            </p>
                            <p className="text-sm text-stone-700">{deliveryAddress.text}</p>
                            {order.deliveryAddress?.recipientName && (
                                <p className="text-xs text-stone-500 mt-0.5">
                                    Attn: {order.deliveryAddress.recipientName}
                                </p>
                            )}
                            {deliveryAddress.source === 'customer' && (
                                <p className="text-xs text-stone-400 mt-1">
                                    Customer&rsquo;s account address &mdash; this order carried none of its own.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Notes */}
                    {order.notes && (
                        <div className="bg-stone-50 rounded-xl p-4">
                            <p className="text-xs text-stone-500 uppercase tracking-wider mb-1">Order Notes</p>
                            <p className="text-sm text-stone-700 whitespace-pre-line">{order.notes}</p>
                        </div>
                    )}

                    {/* Verification */}
                    {order.verification && (
                        <div className="bg-stone-50 rounded-xl p-4">
                            <p className="text-xs text-stone-500 uppercase tracking-wider mb-2">Order Verification</p>
                            {order.verification.method === 'signature' && (
                                <div>
                                    <p className="text-xs text-stone-500 mb-2">HoReCa Signature — {new Date(order.verification.timestamp).toLocaleString()}</p>
                                    <div className="bg-white border border-stone-200 rounded-lg p-2 inline-block">
                                        <img src={order.verification.signatureDataUrl} alt="HoReCa signature" className="h-20 object-contain" />
                                    </div>
                                </div>
                            )}
                            {order.verification.method === 'call_reference' && (
                                <div className="space-y-1">
                                    <p className="text-sm text-stone-700"><span className="font-medium">Caller:</span> {order.verification.callerName}</p>
                                    <p className="text-sm text-stone-700"><span className="font-medium">Call Date:</span> {order.verification.callDate} at {order.verification.callTime}</p>
                                    {order.verification.referenceNumber && (
                                        <p className="text-sm text-stone-700"><span className="font-medium">Reference:</span> {order.verification.referenceNumber}</p>
                                    )}
                                    <p className="text-xs text-stone-400 mt-1">Recorded {new Date(order.verification.timestamp).toLocaleString()}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Modal>

            {/* Sibling, not a child: it mounts after this modal, so overlayStack hands
                it the higher z automatically. Never add a z-* class to compensate. */}
            {paymentAction && (
                <PaymentActionModal
                    isOpen
                    orderId={order.id}
                    targetStatus={paymentAction}
                    reasonRequired={isManager}
                    isSubmitting={updateInvoiceStatus.isPending}
                    errorMessage={paymentError}
                    onConfirm={submitPaymentAction}
                    onCancel={() => { setPaymentAction(null); setPaymentError(undefined); }}
                />
            )}

            {cancelOpen && (
                <CancelOrderModal
                    isOpen
                    orderId={order.id}
                    orderTotal={order.total ?? 0}
                    customerName={order.hoReCa?.name}
                    invoiceWillCancel={Boolean(invoice) && invoice?.status !== 'paid'}
                    isSubmitting={cancelMutation.isPending}
                    errorMessage={cancelError}
                    onConfirm={submitCancel}
                    onCancel={() => { setCancelOpen(false); setCancelError(undefined); }}
                />
            )}
        </>
    );
};

export default OrderDetailView;

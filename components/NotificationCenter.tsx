import React, { Fragment, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCheck } from 'lucide-react';
import type { AppNotification } from '../types';
import NotificationBell from './NotificationBell';
import NotificationItem from './NotificationItem';
import PendingPoAlertItem from './admin/PendingPoAlertItem';
import { usePendingPos } from '@/hooks/queries/usePendingPos';
import { placePopover, type PopoverPlacement } from '@/lib/popoverPosition';
import { CHROME_Z } from './ui/overlayStack';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { MODULE_SHOP } from '@/lib/modules';
import { qrActionLabel, qrNotificationAction, type QrNotificationAction } from '@/lib/qr/notificationText';

// Kitchen QR actions open an overlay in place. Both ship with the shop module, so
// both are gated at the declaration and a tenant without it carries neither chunk.
const QrRequestReviewModal = MODULE_SHOP ? lazyWithRetry(() => import('./qr/QrRequestReviewModal')) : null;
const QrAccessPanel = MODULE_SHOP ? lazyWithRetry(() => import('./qr/QrAccessPanel')) : null;

interface NotificationCenterProps {
    notifications: AppNotification[];
    onMarkRead: (id: string) => void;
    onMarkAllRead: () => void;
    isAdminOrManager: boolean;
    /** Routes the admin shell to the PO Inbox queue (sets ?subtab=queue). */
    onOpenPoInbox: () => void;
    /**
     * Takes the user to their order history. Optional: without it a
     * `qr_order_approved` / `qr_order_rejected` notification just marks itself read.
     * `orderId` is the order the approval placed (null for a rejection).
     */
    onOpenOrders?: (orderId: string | null) => void;
    /**
     * Takes kitchen staff to Order home, where a rejected order's "Not approved" card
     * says why. Optional: without it a `qr_order_rejected` notification just marks
     * itself read. The shell passes it for QR Staff only.
     */
    onOpenKitchen?: () => void;
}

const MAX_PO_ROWS = 5;

/** What the panel asks for. Both are only preferences — `placePopover` narrows
 *  the width and caps the height against the real viewport, which is the half
 *  that was missing: the old `w-72 max-w-[calc(100vw-1.5rem)]` cap computed to
 *  336px against a 288px panel, so it never engaged, and nothing clamped the
 *  panel's left offset at all. */
const PANEL_WIDTH = 288;
const PANEL_MAX_HEIGHT = 440;

/**
 * Single bell trigger + sectioned dropdown that merges the PO Inbox
 * "awaiting review" queue (admin/manager only) and app notifications.
 * The combined badge counts both. Replaces the former side-by-side
 * POInboxHeaderBadge + NotificationBell pair.
 */
const NotificationCenter: React.FC<NotificationCenterProps> = ({
    notifications,
    onMarkRead,
    onMarkAllRead,
    isAdminOrManager,
    onOpenPoInbox,
    onOpenOrders,
    onOpenKitchen,
}) => {
    const [open, setOpen] = useState(false);
    // Overlays a kitchen-QR notification opens. Held here, not in the dropdown, so
    // they outlive the panel closing behind them.
    const [reviewRequestId, setReviewRequestId] = useState<string | null>(null);
    const [accessHoReCaId, setAccessHoReCaId] = useState<number | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    // The panel is portalled to document.body, so it is NOT inside rootRef any
    // more and the outside-click test below has to know about it separately.
    // Without this every click *inside* the panel reads as an outside click —
    // "Mark all read" and every notification row would close the panel instead
    // of doing their job.
    const panelRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<PopoverPlacement | null>(null);

    // Admin-only PO fetch. enabled:false ⇒ non-admins issue zero requests and
    // the hook order stays stable (no conditional hook call). The needs_review
    // count is just the length of this list, so no separate count query.
    const { data: pendingPos } = usePendingPos('needs_review', { enabled: isAdminOrManager });
    const pendingPoCount = isAdminOrManager ? (pendingPos?.length ?? 0) : 0;

    const unreadNotifications = useMemo(
        () => notifications.filter(n => !n.read).length,
        [notifications],
    );
    const combinedCount = unreadNotifications + pendingPoCount;

    // Measured before paint, so the panel never renders at 0,0 and jumps.
    useLayoutEffect(() => {
        if (!open) return;
        const measure = () => {
            const el = rootRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            setPlacement(placePopover({
                trigger: r,
                preferredWidth: PANEL_WIDTH,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                // Hangs off the bell's right edge: the bell sits on the right of
                // both its homes (the sidebar header and the mobile top bar), so
                // a left-aligned panel runs off the screen before it is clamped.
                align: 'right',
                preferredMaxHeight: PANEL_MAX_HEIGHT,
            }));
        };
        measure();
        // REPOSITION on resize; do NOT close. Tooltip closes on resize, which is
        // right for a transient hint and wrong here — opening the soft keyboard
        // resizes the layout viewport (`interactive-widget=resizes-content`), and
        // a notification list that vanishes when the keyboard appears is a bug.
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [open]);

    // Close on outside click or Escape while open.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            const target = e.target as Node;
            const inTrigger = rootRef.current?.contains(target);
            const inPanel = panelRef.current?.contains(target);
            if (!inTrigger && !inPanel) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const poRows = (pendingPos ?? []).slice(0, MAX_PO_ROWS);
    const extraPoCount = Math.max(0, pendingPoCount - poRows.length);
    const showPoSection = isAdminOrManager && pendingPoCount > 0;

    const handleOpenPoInbox = () => {
        onOpenPoInbox();
        setOpen(false);
    };

    // Whether a tap on this action can do anything here. A notification whose action
    // is unavailable (module not shipped, no navigation given) is a plain notification.
    const canRun = (action: QrNotificationAction | null): action is QrNotificationAction => {
        if (!action) return false;
        if (action.kind === 'review') return QrRequestReviewModal !== null;
        if (action.kind === 'access') return QrAccessPanel !== null;
        if (action.kind === 'kitchen') return onOpenKitchen !== undefined;
        return onOpenOrders !== undefined;
    };

    const handleActivate = (notif: AppNotification) => {
        const action = qrNotificationAction(notif);
        if (!canRun(action)) return;
        if (action.kind === 'review') setReviewRequestId(action.requestId);
        else if (action.kind === 'access') setAccessHoReCaId(action.horecaId);
        else if (action.kind === 'kitchen') onOpenKitchen?.();
        else onOpenOrders?.(action.orderId);
        setOpen(false);
    };

    return (
        <div className="relative" ref={rootRef}>
            <NotificationBell unreadCount={combinedCount} onClick={() => setOpen(o => !o)} />
            {open && placement && createPortal(
                <div
                    ref={panelRef}
                    // PORTALLED, and it has to be. The sidebar that hosts this
                    // bell is `backdrop-blur-md`, which makes it a containing
                    // block — a `fixed` child would position against the 208px
                    // sidebar rather than the viewport, so it could never be
                    // clamped to a 360px screen from in there.
                    //
                    // Solid `bg-white`, not the former `bg-white/90
                    // backdrop-blur-xl`: over the warehouse map a translucent
                    // list is hard to read, and F35 measured that the cost is
                    // having a backdrop-filter layer at all.
                    className="bg-white rounded-xl border border-stone-200 shadow-xl overflow-hidden flex flex-col"
                    style={{
                        position: 'fixed',
                        left: placement.left,
                        top: placement.top,
                        width: placement.width,
                        maxHeight: placement.maxHeight,
                        zIndex: CHROME_Z,
                    }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 flex-shrink-0">
                        <h3 className="text-sm font-semibold text-stone-900">Notifications</h3>
                        <div className="flex items-center gap-2">
                            {unreadNotifications > 0 && (
                                <button
                                    onClick={onMarkAllRead}
                                    // `-my-2` keeps the desktop header row the
                                    // same height while the coarse-pointer floor
                                    // gives a gloved thumb something to hit; the
                                    // control was ~14px tall with a 10px label.
                                    className="flex items-center gap-1 -my-2 py-2 text-xs text-stone-500 hover:text-stone-700 transition-colors cursor-pointer touch-target-y"
                                >
                                    <CheckCheck className="w-3.5 h-3.5" />
                                    Mark all read
                                </button>
                            )}
                            <button
                                onClick={() => setOpen(false)}
                                aria-label="Close notifications"
                                className="inline-flex items-center justify-center -my-2 rounded-lg text-stone-500 hover:text-stone-700 transition-colors cursor-pointer p-1 touch-target"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Sections */}
                    <div className="overflow-y-auto flex-1">
                        {showPoSection && (
                            <section>
                                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">PO Inbox</span>
                                    <button
                                        onClick={handleOpenPoInbox}
                                        className="text-xs text-nexgen-blue hover:underline cursor-pointer touch-target-y"
                                    >
                                        Review all →
                                    </button>
                                </div>
                                <div className="divide-y divide-stone-100">
                                    {poRows.map(row => (
                                        <PendingPoAlertItem key={row.id} row={row} onClick={handleOpenPoInbox} />
                                    ))}
                                </div>
                                {extraPoCount > 0 && (
                                    <button
                                        onClick={handleOpenPoInbox}
                                        className="w-full text-left px-4 py-2 text-xs text-stone-500 hover:bg-stone-50 cursor-pointer touch-target-y"
                                    >
                                        +{extraPoCount} more awaiting review
                                    </button>
                                )}
                            </section>
                        )}

                        {showPoSection && notifications.length > 0 && (
                            <div className="border-t border-stone-200" />
                        )}

                        <section>
                            {showPoSection && (
                                <div className="px-4 pt-3 pb-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Notifications</span>
                                </div>
                            )}
                            {notifications.length === 0 ? (
                                <div className="py-8 text-center text-stone-500 text-sm">
                                    No notifications
                                </div>
                            ) : (
                                <div className="divide-y divide-stone-100">
                                    {notifications.map(notif => {
                                        // Gated on the module itself (not only on the overlays being
                                        // null) so the helper is dropped from a tenant without it.
                                        const action = MODULE_SHOP ? qrNotificationAction(notif) : null;
                                        const runnable = MODULE_SHOP && canRun(action);
                                        return (
                                            <NotificationItem
                                                key={notif.id}
                                                notif={notif}
                                                onMarkRead={onMarkRead}
                                                onActivate={runnable ? handleActivate : undefined}
                                                actionLabel={runnable ? qrActionLabel(action) : undefined}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    </div>
                </div>,
                document.body,
            )}

            {QrRequestReviewModal && reviewRequestId && (
                <ErrorBoundary label="Order review">
                    <Suspense fallback={null}>
                        <Fragment key={reviewRequestId}>
                            <QrRequestReviewModal requestId={reviewRequestId} onClose={() => setReviewRequestId(null)} />
                        </Fragment>
                    </Suspense>
                </ErrorBoundary>
            )}
            {QrAccessPanel && accessHoReCaId !== null && (
                <ErrorBoundary label="QR & PINs">
                    <Suspense fallback={null}>
                        <QrAccessPanel horecaId={accessHoReCaId} open onClose={() => setAccessHoReCaId(null)} />
                    </Suspense>
                </ErrorBoundary>
            )}
        </div>
    );
};

export default NotificationCenter;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, CheckCheck } from 'lucide-react';
import type { AppNotification } from '../types';
import NotificationBell from './NotificationBell';
import NotificationItem from './NotificationItem';
import PendingPoAlertItem from './admin/PendingPoAlertItem';
import { usePendingPos } from '@/hooks/queries/usePendingPos';

interface NotificationCenterProps {
    notifications: AppNotification[];
    onMarkRead: (id: string) => void;
    onMarkAllRead: () => void;
    isAdminOrManager: boolean;
    /** Routes the admin shell to the PO Inbox queue (sets ?subtab=queue). */
    onOpenPoInbox: () => void;
}

const MAX_PO_ROWS = 5;

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
}) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

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

    // Close on outside click or Escape while open.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

    return (
        <div className="relative" ref={rootRef}>
            <NotificationBell unreadCount={combinedCount} onClick={() => setOpen(o => !o)} />
            {open && (
                <div className="absolute top-full right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-white/90 backdrop-blur-xl rounded-xl border border-stone-200 shadow-xl overflow-hidden max-h-[440px] flex flex-col z-50">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 flex-shrink-0">
                        <h3 className="text-sm font-semibold text-stone-900">Notifications</h3>
                        <div className="flex items-center gap-2">
                            {unreadNotifications > 0 && (
                                <button
                                    onClick={onMarkAllRead}
                                    className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-700 transition-colors cursor-pointer"
                                >
                                    <CheckCheck className="w-3 h-3" />
                                    Mark all read
                                </button>
                            )}
                            <button
                                onClick={() => setOpen(false)}
                                aria-label="Close notifications"
                                className="text-stone-400 hover:text-stone-700 transition-colors cursor-pointer p-1"
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
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">PO Inbox</span>
                                    <button
                                        onClick={handleOpenPoInbox}
                                        className="text-[10px] text-nexgen-blue hover:underline cursor-pointer"
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
                                        className="w-full text-left px-4 py-2 text-[11px] text-stone-500 hover:bg-stone-50 cursor-pointer"
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
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Notifications</span>
                                </div>
                            )}
                            {notifications.length === 0 ? (
                                <div className="py-8 text-center text-stone-500 text-sm">
                                    No notifications
                                </div>
                            ) : (
                                <div className="divide-y divide-stone-100">
                                    {notifications.map(notif => (
                                        <NotificationItem key={notif.id} notif={notif} onMarkRead={onMarkRead} />
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationCenter;

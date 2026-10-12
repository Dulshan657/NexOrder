import React from 'react';
import type { AppNotification } from '../types';
import { Package, ShoppingCart, FileText, Info, MapPin, CheckCircle2, GitPullRequest, XCircle, QrCode, Lock } from 'lucide-react';
import { qrNotificationDetail } from '../lib/qr/notificationText';
import { MODULE_SHOP } from '../lib/modules';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
    low_stock: Package,
    order_status: ShoppingCart,
    invoice: FileText,
    system: Info,
    route_assigned: MapPin,
    route_completed: CheckCircle2,
    change_request: GitPullRequest,
    change_approved: CheckCircle2,
    change_rejected: XCircle,
    qr_order_pending: QrCode,
    qr_order_approved: CheckCircle2,
    qr_order_rejected: XCircle,
    qr_code_locked: Lock,
};

const formatRelativeTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
};

interface NotificationItemProps {
    notif: AppNotification;
    onMarkRead: (id: string) => void;
    /** Runs after a tap, once the notification is marked read. Only passed for a
     *  notification that has somewhere to go (kitchen QR types today). */
    onActivate?: (notif: AppNotification) => void;
    /** What tapping does ("Review order"). Shown under the message when `onActivate` is set. */
    actionLabel?: string;
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notif, onMarkRead, onActivate, actionLabel }) => {
    const Icon = ICON_MAP[notif.type] || Info;
    // Kitchen-QR notifications exist only where the shop module ships; gating the call
    // (not just the display) lets the bundler drop the helper from a tenant without it.
    const detail = MODULE_SHOP ? qrNotificationDetail(notif) : null;
    return (
        <button
            onClick={() => {
                if (!notif.read) onMarkRead(notif.id);
                onActivate?.(notif);
            }}
            className={`w-full text-left px-4 py-3 flex gap-3 transition-colors cursor-pointer ${
                notif.read ? 'opacity-60' : 'bg-nexgen-blue/5 hover:bg-stone-50'
            }`}
        >
            <div className={`p-1.5 rounded-md flex-shrink-0 ${
                notif.type === 'low_stock' ? 'bg-amber-50 text-amber-600' :
                notif.type === 'order_status' ? 'bg-blue-50 text-blue-600' :
                notif.type === 'invoice' ? 'bg-emerald-50 text-emerald-600' :
                notif.type === 'route_assigned' ? 'bg-teal-50 text-teal-600' :
                notif.type === 'route_completed' ? 'bg-emerald-50 text-emerald-600' :
                notif.type === 'change_request' ? 'bg-orange-50 text-orange-600' :
                notif.type === 'change_approved' ? 'bg-emerald-50 text-emerald-600' :
                notif.type === 'change_rejected' ? 'bg-red-50 text-red-600' :
                notif.type === 'qr_order_pending' ? 'bg-amber-50 text-amber-600' :
                notif.type === 'qr_order_approved' ? 'bg-emerald-50 text-emerald-600' :
                notif.type === 'qr_order_rejected' ? 'bg-red-50 text-red-600' :
                notif.type === 'qr_code_locked' ? 'bg-red-50 text-red-600' :
                'bg-stone-100 text-stone-500'
            }`}>
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-xs ${notif.read ? 'text-stone-500' : 'text-stone-800'}`}>
                    {notif.message}
                </p>
                {detail && (
                    <p className="text-[11px] text-stone-600 mt-0.5">{detail}</p>
                )}
                {onActivate && actionLabel && (
                    <p className="text-[11px] font-medium text-nexgen-blue-dark mt-0.5">{actionLabel} &rarr;</p>
                )}
                <p className="text-[11px] text-stone-500 mt-0.5">{formatRelativeTime(notif.timestamp)}</p>
            </div>
            {!notif.read && (
                <span className="w-2 h-2 rounded-full bg-nexgen-blue flex-shrink-0 mt-1" />
            )}
        </button>
    );
};

export default NotificationItem;

import React from 'react';
import type { AppNotification } from '../types';
import { Package, ShoppingCart, FileText, Info, MapPin, CheckCircle2, GitPullRequest, XCircle } from 'lucide-react';

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
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notif, onMarkRead }) => {
    const Icon = ICON_MAP[notif.type] || Info;
    return (
        <button
            onClick={() => !notif.read && onMarkRead(notif.id)}
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
                'bg-stone-100 text-stone-500'
            }`}>
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-xs ${notif.read ? 'text-stone-400' : 'text-stone-800'}`}>
                    {notif.message}
                </p>
                <p className="text-[10px] text-stone-400 mt-0.5">{formatRelativeTime(notif.timestamp)}</p>
            </div>
            {!notif.read && (
                <span className="w-2 h-2 rounded-full bg-nexgen-blue flex-shrink-0 mt-1" />
            )}
        </button>
    );
};

export default NotificationItem;

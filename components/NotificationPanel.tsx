import React from 'react';
import type { AppNotification } from '../types';
import { X, Package, ShoppingCart, FileText, Info, CheckCheck, MapPin, CheckCircle2, GitPullRequest, XCircle } from 'lucide-react';

interface NotificationPanelProps {
    notifications: AppNotification[];
    onMarkRead: (id: string) => void;
    onMarkAllRead: () => void;
    onClose: () => void;
}

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

const NotificationPanel: React.FC<NotificationPanelProps> = ({ notifications, onMarkRead, onMarkAllRead, onClose }) => {
    const unreadCount = notifications.filter(n => !n.read).length;

    return (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white/90 backdrop-blur-xl rounded-xl border border-stone-200 shadow-xl overflow-hidden max-h-[400px] flex flex-col z-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 flex-shrink-0">
                <h3 className="text-sm font-semibold text-stone-900">Notifications</h3>
                <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                        <button
                            onClick={onMarkAllRead}
                            className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-700 transition-colors cursor-pointer"
                        >
                            <CheckCheck className="w-3 h-3" />
                            Mark all read
                        </button>
                    )}
                    <button onClick={onClose} className="text-stone-400 hover:text-stone-700 transition-colors cursor-pointer p-1">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Notification List */}
            <div className="overflow-y-auto flex-1">
                {notifications.length === 0 ? (
                    <div className="py-8 text-center text-stone-500 text-sm">
                        No notifications
                    </div>
                ) : (
                    <div className="divide-y divide-stone-100">
                        {notifications.map(notif => {
                            const Icon = ICON_MAP[notif.type] || Info;
                            return (
                                <button
                                    key={notif.id}
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
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default NotificationPanel;

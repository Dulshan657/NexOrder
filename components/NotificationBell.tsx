import React from 'react';
import { Bell } from 'lucide-react';
import AnimatedIcon from './AnimatedIcon';

interface NotificationBellProps {
    unreadCount: number;
    onClick: () => void;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ unreadCount, onClick }) => {
    return (
        <button
            onClick={onClick}
            className="relative inline-flex items-center justify-center p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer touch-target"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
            <AnimatedIcon icon={Bell} animation="ring" className="w-5 h-5" />
            {unreadCount > 0 && (
                // `w-4.5 h-4.5` used to sit here too. In Tailwind v4's dynamic
                // spacing that is also 18px, so it was not a conflict of values
                // — it was two `height` declarations whose winner was decided by
                // generated source order. Deleted rather than reconciled.
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center min-w-[18px] h-[18px] px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                </span>
            )}
        </button>
    );
};

export default NotificationBell;

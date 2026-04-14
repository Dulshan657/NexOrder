import React from 'react';
import type { OrderStatus } from '../types';
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '../constants';

interface StatusBadgeProps {
    status: OrderStatus;
    size?: 'sm' | 'md';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
    const colors = ORDER_STATUS_COLORS[status];
    const label = ORDER_STATUS_LABELS[status];
    const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

    return (
        <span className={`inline-flex items-center justify-center gap-1.5 font-medium rounded-full border ${colors.bg} ${colors.text} ${colors.border} ${sizeClasses}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors.text.replace('text-', 'bg-')}`} />
            {label}
        </span>
    );
};

export default StatusBadge;

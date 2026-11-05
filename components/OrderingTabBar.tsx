import React from 'react';
import { PageTabs } from './ui/PageTabs';

export type OrderingTabKey = 'catalogue' | 'pantry' | 'reorder';

interface OrderingTabBarProps {
    activeTab: OrderingTabKey;
    onTabChange: (tab: OrderingTabKey) => void;
    pantryItemCount: number;
    pantryEstTotal?: number;
    hasHoReCa: boolean;
    hasLastOrder: boolean;
}

const NEEDS_HORECA = 'Select a HoReCa first';

const OrderingTabBar: React.FC<OrderingTabBarProps> = ({ activeTab, onTabChange, pantryItemCount, pantryEstTotal, hasHoReCa, hasLastOrder }) => {
    const showEstimate = pantryItemCount > 0 && pantryEstTotal !== undefined && pantryEstTotal > 0;
    const needsHoReCa = { disabled: !hasHoReCa, title: hasHoReCa ? undefined : NEEDS_HORECA };

    const tabs = [
        { id: 'catalogue' as const, label: 'Catalogue' },
        {
            id: 'pantry' as const,
            label: (
                <>
                    Pantry List
                    {showEstimate && <span className="ml-1 text-xs text-stone-600 hidden sm:inline">~${pantryEstTotal.toFixed(0)}</span>}
                </>
            ),
            badge: pantryItemCount,
            ...needsHoReCa,
        },
        ...(hasLastOrder || hasHoReCa ? [{ id: 'reorder' as const, label: 'Reorder', ...needsHoReCa }] : []),
    ];

    return <PageTabs ariaLabel="Shop sections" tabs={tabs} activeId={activeTab} onChange={onTabChange} />;
};

export default OrderingTabBar;

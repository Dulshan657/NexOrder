import React from 'react';
import { ShoppingBag, ClipboardList, RotateCcw } from 'lucide-react';

export type OrderingTabKey = 'catalogue' | 'pantry' | 'reorder';

interface OrderingTabBarProps {
    activeTab: OrderingTabKey;
    onTabChange: (tab: OrderingTabKey) => void;
    pantryItemCount: number;
    pantryEstTotal?: number;
    hasHoReCa: boolean;
    hasLastOrder: boolean;
}

const OrderingTabBar: React.FC<OrderingTabBarProps> = ({ activeTab, onTabChange, pantryItemCount, pantryEstTotal, hasHoReCa, hasLastOrder }) => {
    const tabs: { key: OrderingTabKey; label: string; icon: typeof ShoppingBag; badge?: number; estTotal?: number; requiresHoReCa: boolean; hidden?: boolean }[] = [
        { key: 'catalogue', label: 'Catalogue', icon: ShoppingBag, requiresHoReCa: false },
        { key: 'pantry', label: 'Pantry List', icon: ClipboardList, badge: pantryItemCount, estTotal: pantryEstTotal, requiresHoReCa: true },
        { key: 'reorder', label: 'Reorder', icon: RotateCcw, requiresHoReCa: true, hidden: !hasLastOrder && !hasHoReCa },
    ];

    // `max-w-full` + a tighter phone-width tab: at 360px the three tabs (Pantry's
    // count AND ~$ estimate included) summed to ~413px against ~328px of room, so
    // this bar overhung the page and dragged the whole Shop scroller sideways by
    // ~65px once a tab was focused. From `sm` up it is unchanged.
    return (
        <div className="bg-stone-200/50 p-1 rounded-xl inline-flex max-w-full space-x-1 mb-4">
            {tabs.filter(tab => !tab.hidden).map(tab => {
                const isActive = activeTab === tab.key;
                const isDisabled = tab.requiresHoReCa && !hasHoReCa;
                const Icon = tab.icon;

                return (
                    <button
                        key={tab.key}
                        onClick={() => {
                            if (!isDisabled) onTabChange(tab.key);
                        }}
                        className={`flex items-center min-w-0 whitespace-nowrap px-2 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                            isActive
                                ? 'bg-white text-stone-900 shadow-sm'
                                : isDisabled
                                    ? 'text-stone-500 cursor-not-allowed'
                                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50 cursor-pointer'
                        }`}
                        disabled={isDisabled}
                        title={isDisabled ? 'Select a HoReCa first' : undefined}
                    >
                        <Icon className="w-4 h-4 mr-1 sm:mr-2 shrink-0" />
                        {tab.label}
                        {tab.badge !== undefined && tab.badge > 0 && (
                            <span className="ml-1 sm:ml-2 bg-emerald-100 text-emerald-700 py-0.5 px-2 rounded-full text-xs font-semibold">
                                {tab.badge}
                                {tab.estTotal !== undefined && tab.estTotal > 0 && (
                                    <span className="ml-1 text-emerald-500 font-normal hidden sm:inline">~${tab.estTotal.toFixed(0)}</span>
                                )}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default OrderingTabBar;

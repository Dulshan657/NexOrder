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

    return (
        <div className="bg-stone-200/50 p-1 rounded-xl inline-flex space-x-1 mb-4">
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
                        className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                            isActive
                                ? 'bg-white text-stone-900 shadow-sm'
                                : isDisabled
                                    ? 'text-stone-400 cursor-not-allowed'
                                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50 cursor-pointer'
                        }`}
                        disabled={isDisabled}
                        title={isDisabled ? 'Select a HoReCa first' : undefined}
                    >
                        <Icon className="w-4 h-4 mr-2" />
                        {tab.label}
                        {tab.badge !== undefined && tab.badge > 0 && (
                            <span className="ml-2 bg-emerald-100 text-emerald-700 py-0.5 px-2 rounded-full text-xs font-semibold">
                                {tab.badge}
                                {tab.estTotal !== undefined && tab.estTotal > 0 && (
                                    <span className="ml-1 text-emerald-500 font-normal">~${tab.estTotal.toFixed(0)}</span>
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

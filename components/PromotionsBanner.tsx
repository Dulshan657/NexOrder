import React, { useState } from 'react';
import type { Promotion, HoReCa, User } from '../types';
import { X, Tag, Percent, Gift, Package2, Flame } from 'lucide-react';
import { isPromotionActive, isPromotionApplicable } from '../pricing';

interface PromotionsBannerProps {
    promotions: Promotion[];
    customer: HoReCa | null;
    currentUser: User | null;
    products: { id: number; name: string; category: string }[];
    onApplyPromo?: (promo: Promotion) => void;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; bg: string; border: string; text: string }> = {
    percentage: { icon: <Percent className="w-4 h-4" />, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' },
    fixed_price: { icon: <Tag className="w-4 h-4" />, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800' },
    bogo: { icon: <Gift className="w-4 h-4" />, bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800' },
    bundle: { icon: <Package2 className="w-4 h-4" />, bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-800' },
    clearance: { icon: <Flame className="w-4 h-4" />, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800' },
};

const PromotionsBanner: React.FC<PromotionsBannerProps> = ({ promotions, customer, currentUser, products, onApplyPromo }) => {
    const [dismissed, setDismissed] = useState(false);

    if (dismissed) return null;

    // Filter to active promos relevant to this customer (use a dummy product for storewide checks)
    const now = new Date();
    const relevantPromos = promotions.filter(promo => {
        if (!isPromotionActive(promo, now)) return false;
        // For storewide or "all" targeting, always show
        if (promo.targeting.kind === 'all' && promo.scope.kind === 'storewide') return true;
        if (promo.targeting.kind === 'all') return true;
        // Check targeting
        if (promo.targeting.kind === 'horecas' && customer && promo.targeting.hoReCaIds.includes(customer.id)) return true;
        if (promo.targeting.kind === 'tier' && customer?.tier && promo.targeting.tiers.includes(customer.tier)) return true;
        if (promo.targeting.kind === 'rep' && currentUser && promo.targeting.repUserId === currentUser.id) return true;
        return false;
    }).slice(0, 4);

    if (relevantPromos.length === 0) return null;

    return (
        <div className="relative">
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                {relevantPromos.map(promo => {
                    const config = TYPE_CONFIG[promo.type] ?? TYPE_CONFIG.percentage;
                    const clickable = !!onApplyPromo && (promo.type === 'bogo' || promo.type === 'bundle');
                    const unitNote = (promo.type === 'bogo' || promo.type === 'bundle')
                        ? ` · per ${promo.appliesTo ?? 'unit'}`
                        : '';
                    return (
                        <button
                            key={promo.id}
                            type="button"
                            onClick={() => clickable && onApplyPromo?.(promo)}
                            disabled={!clickable}
                            className={`flex-shrink-0 flex items-center gap-3 px-4 py-3 rounded-xl border text-left ${config.bg} ${config.border} min-w-[240px] max-w-[320px] ${clickable ? 'cursor-pointer hover:shadow-md hover:scale-[1.02] transition-transform' : 'cursor-default'}`}
                        >
                            <div className={`${config.text} flex-shrink-0`}>{config.icon}</div>
                            <div className="min-w-0">
                                <p className={`text-sm font-semibold ${config.text} truncate`}>{promo.name}</p>
                                <p className="text-xs text-stone-500 truncate">{promo.description}{unitNote}</p>
                                {clickable && <p className="text-[10px] text-stone-400 mt-0.5">Tap to add to order</p>}
                            </div>
                        </button>
                    );
                })}
            </div>
            <button
                onClick={() => setDismissed(true)}
                className="absolute -top-1 -right-1 w-5 h-5 bg-stone-200 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-300 cursor-pointer z-10"
            >
                <X className="w-3 h-3" />
            </button>
        </div>
    );
};

export default PromotionsBanner;

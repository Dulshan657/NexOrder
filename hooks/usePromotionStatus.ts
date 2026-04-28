import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Promotion } from '../types';

/**
 * Auto-activate scheduled promotions and auto-expire ended ones.
 * Runs every 60 seconds.
 */
export function usePromotionStatus(
    promotions: Promotion[],
    setPromotions: Dispatch<SetStateAction<Promotion[]>>,
) {
    useEffect(() => {
        const check = () => {
            const nowStr = new Date().toISOString().split('T')[0];
            let changed = false;

            const updated = promotions.map(promo => {
                // Auto-expire: active promo past end date
                if (promo.isActive && promo.endDate && nowStr > promo.endDate) {
                    changed = true;
                    return { ...promo, isActive: false };
                }
                return promo;
            });

            if (changed) {
                setPromotions(updated);
            }
        };

        check(); // Run immediately
        const interval = setInterval(check, 60_000);
        return () => clearInterval(interval);
    }, [promotions, setPromotions]);
}

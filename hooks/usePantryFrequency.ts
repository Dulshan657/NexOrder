import { useMemo } from 'react';
import type { Order } from '../types';

export interface PantryFrequencyEntry {
    lastOrderedDate: string | null;
    count30d: number;
    count90d: number;
    avgIntervalDays: number | null;
    predictedNextOrderDate: string | null;
    dueSoon: boolean;
}

export type PantryFrequencyMap = Record<number, PantryFrequencyEntry>;

const DAY_MS = 86_400_000;
const WINDOW_30 = 30 * DAY_MS;
const WINDOW_90 = 90 * DAY_MS;
const DUE_SOON_HORIZON = 7 * DAY_MS;

interface ProductOrderHistory {
    dates: number[];
}

function buildHistory(orders: Order[], horecaId: number | null): Map<number, ProductOrderHistory> {
    const history = new Map<number, ProductOrderHistory>();
    if (horecaId === null) return history;

    const relevant = orders.filter(o => o.hoReCa.id === horecaId);

    for (const order of relevant) {
        const ts = new Date(order.orderDate).getTime();
        if (Number.isNaN(ts)) continue;
        const seen = new Set<number>();
        for (const item of order.items) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            let entry = history.get(item.id);
            if (!entry) {
                entry = { dates: [] };
                history.set(item.id, entry);
            }
            entry.dates.push(ts);
        }
    }

    for (const entry of history.values()) {
        entry.dates.sort((a, b) => a - b);
    }

    return history;
}

function summarise(entry: ProductOrderHistory, now: number): PantryFrequencyEntry {
    const { dates } = entry;
    if (dates.length === 0) {
        return {
            lastOrderedDate: null,
            count30d: 0,
            count90d: 0,
            avgIntervalDays: null,
            predictedNextOrderDate: null,
            dueSoon: false,
        };
    }

    let count30d = 0;
    let count90d = 0;
    for (const ts of dates) {
        const age = now - ts;
        if (age <= WINDOW_30) count30d += 1;
        if (age <= WINDOW_90) count90d += 1;
    }

    const lastTs = dates[dates.length - 1];
    const lastOrderedDate = new Date(lastTs).toISOString();

    let avgIntervalDays: number | null = null;
    let predictedNextOrderDate: string | null = null;
    let dueSoon = false;

    if (dates.length >= 2) {
        let totalGap = 0;
        for (let i = 1; i < dates.length; i++) {
            totalGap += dates[i] - dates[i - 1];
        }
        const avgMs = totalGap / (dates.length - 1);
        avgIntervalDays = Math.round(avgMs / DAY_MS);
        const predictedTs = lastTs + avgMs;
        predictedNextOrderDate = new Date(predictedTs).toISOString();
        const delta = predictedTs - now;
        dueSoon = delta <= DUE_SOON_HORIZON;
    }

    return {
        lastOrderedDate,
        count30d,
        count90d,
        avgIntervalDays,
        predictedNextOrderDate,
        dueSoon,
    };
}

export function usePantryFrequency(orders: Order[], horecaId: number | null): PantryFrequencyMap {
    return useMemo(() => {
        const now = Date.now();
        const history = buildHistory(orders, horecaId);
        const map: PantryFrequencyMap = {};
        for (const [productId, entry] of history) {
            map[productId] = summarise(entry, now);
        }
        return map;
    }, [orders, horecaId]);
}

export function daysUntil(iso: string | null): number | null {
    if (!iso) return null;
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return null;
    return Math.round((ts - Date.now()) / DAY_MS);
}

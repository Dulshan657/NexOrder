import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';

const STORAGE_PREFIX = 'nexorder_v1_';

function useLocalStorage<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
    const prefixedKey = `${STORAGE_PREFIX}${key}`;

    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(prefixedKey);
            return item ? (JSON.parse(item) as T) : initialValue;
        } catch {
            return initialValue;
        }
    });

    useEffect(() => {
        try {
            window.localStorage.setItem(prefixedKey, JSON.stringify(storedValue));
        } catch {
            // Quota exceeded or other storage error — continue with in-memory state
        }
    }, [prefixedKey, storedValue]);

    return [storedValue, setStoredValue];
}

export { useLocalStorage };

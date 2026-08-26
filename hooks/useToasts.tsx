import React, { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import type { Toast, ToastAction, ToastType } from '../types';

/** How long a toast lives. Toasts with an action button stay around longer —
 *  operators need time to read AND press. */
export const TOAST_DURATION_MS = 5000;
export const TOAST_ACTION_DURATION_MS = 8000;
/** Must match the `duration-300` on ToastMessage's transition. The renderer
 *  starts its exit this far before removal, derived rather than hard-coded:
 *  the two used to be independent numbers (4700 here, 5000/8000 there) and an
 *  action toast was invisible — but still occupying layout height, with a dead
 *  button — from 4.7s to 8s. */
export const TOAST_EXIT_MS = 300;

/**
 * The cap exists for a 360px screen. Each toast is ~76px tall there, so three
 * plus their gaps is ~250px of a ~664px visible area. There was no cap at all,
 * and `context/OrderContext.tsx` and `components/admin/SlottingRulesSection.tsx`
 * both raise one toast per item in a `forEach` — enough to bury the screen.
 *
 * Drops the OLDEST. A burst's later messages are the ones the operator has not
 * read yet.
 */
export const MAX_TOASTS = 3;

interface ToastContextType {
  toasts: Toast[];
  addToast: (message: string, type: ToastType, action?: ToastAction) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // A mirror of `toasts`, updated synchronously. `addToast` has to read the
  // current list to decide whether this is a repeat and which toasts the cap
  // evicts, and it cannot do that inside a `setToasts` updater: the updater
  // must stay pure (StrictMode invokes it twice), and a `forEach` firing three
  // adds in one React batch would otherwise have every call read the same
  // stale list — which is how a burst loses toasts.
  const toastsRef = useRef<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const commit = useCallback((next: Toast[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const removeToast = useCallback((id: number) => {
    clearTimer(id);
    commit(toastsRef.current.filter(toast => toast.id !== id));
  }, [clearTimer, commit]);

  const schedule = useCallback((id: number, duration: number) => {
    clearTimer(id);
    timers.current.set(id, setTimeout(() => removeToast(id), duration));
  }, [clearTimer, removeToast]);

  const addToast = useCallback((message: string, type: ToastType, action?: ToastAction) => {
    const current = toastsRef.current;
    const last = current[current.length - 1];

    // Collapse an identical repeat into the toast already on screen, rather
    // than stacking a second slab saying the same thing — an operator pressing
    // a failing control three times is the case this is for.
    //
    // ADJACENT matches only. Collapsing a non-adjacent match would reorder the
    // queue and hide that two *different* operations failed. Toasts carrying an
    // action are exempt: identical labels can close over different handlers.
    if (!action && last && !last.action && last.message === message && last.type === type) {
      const bumped: Toast = { ...last, count: last.count + 1 };
      commit([...current.slice(0, -1), bumped]);
      schedule(bumped.id, bumped.duration);
      return;
    }

    const id = Date.now() + Math.random(); // tolerate sub-millisecond bursts
    const duration = action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS;
    const appended = [...current, { id, message, type, action, duration, count: 1 }];

    // Evicted toasts must have their timers cleared, or a pending removal fires
    // later against an id that is already gone.
    appended.slice(0, Math.max(0, appended.length - MAX_TOASTS)).forEach(t => clearTimer(t.id));

    commit(appended.slice(-MAX_TOASTS));
    schedule(id, duration);
  }, [clearTimer, commit, schedule]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(timer => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToasts = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return context;
};

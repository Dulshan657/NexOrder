import React from 'react';
import { createPortal } from 'react-dom';
import { useToasts, TOAST_EXIT_MS } from '../hooks/useToasts';
import { TOAST_Z } from './ui/overlayStack';
import { ToastType } from '../types';

const ICON_SIZE = 'h-5 w-5 md:h-6 md:w-6';

const ICONS: Record<ToastType, React.ReactElement> = {
  success: (
    <svg xmlns="http://www.w3.org/2000/svg" className={ICON_SIZE} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  error: (
    <svg xmlns="http://www.w3.org/2000/svg" className={ICON_SIZE} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  info: (
    <svg xmlns="http://www.w3.org/2000/svg" className={ICON_SIZE} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

const COLORS: Record<ToastType, { bg: string; text: string; icon: string }> = {
    success: { bg: 'bg-emerald-50', text: 'text-emerald-800', icon: 'text-emerald-500' },
    error: { bg: 'bg-red-50', text: 'text-red-800', icon: 'text-red-500' },
    info: { bg: 'bg-stone-50', text: 'text-stone-800', icon: 'text-stone-500' },
};

const ToastMessage: React.FC<{ toast: import('../types').Toast; onRemove: (id: number) => void }> = ({ toast, onRemove }) => {
    const [isExiting, setIsExiting] = React.useState(false);

    // Derived from the toast's own lifetime, not a second hard-coded number.
    // `duration` also changes when a repeat collapses into this toast and its
    // timer is reset, so the exit has to re-arm with it.
    React.useEffect(() => {
        setIsExiting(false);
        const timer = setTimeout(
            () => setIsExiting(true),
            Math.max(0, toast.duration - TOAST_EXIT_MS),
        );
        return () => clearTimeout(timer);
    }, [toast.duration, toast.count]);

    const colors = COLORS[toast.type];

    return (
        <div
             // Exits UPWARD, not sideways. Below `md` this toast spans the full
             // width of a 360px screen, so the old `translate-x-full` slid it
             // 344px to the right — a transform Chrome can count toward
             // `documentElement.scrollWidth`, which is exactly what the mobile
             // suite's `expectNoHorizontalOverflow` fails on.
             className={`pointer-events-auto flex items-start w-full p-3.5 md:p-4 rounded-xl shadow-lg ring-1 ring-black ring-opacity-5 transition-all duration-300 ease-in-out transform ${colors.bg} ${isExiting ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'}`}
             style={{ willChange: 'transform, opacity' }}
             role={toast.type === 'error' ? 'alert' : 'status'}
        >
            <div className={`flex-shrink-0 ${colors.icon}`}>{ICONS[toast.type]}</div>
            <div className="ml-3 w-0 flex-1 pt-0.5">
                <p className={`text-sm font-medium ${colors.text}`}>
                    {toast.message}
                    {toast.count > 1 && (
                        <span className={`ml-1.5 opacity-70`}>&times;{toast.count}</span>
                    )}
                </p>
                {toast.action && (
                    <button
                        type="button"
                        onClick={() => {
                            toast.action?.onClick();
                            onRemove(toast.id);
                        }}
                        className={`mt-1.5 inline-flex items-center text-xs font-semibold underline underline-offset-2 pointer-coarse:min-h-11 ${colors.text} hover:opacity-80`}
                    >
                        {toast.action.label}
                    </button>
                )}
            </div>
            <div className="ml-3 md:ml-4 flex-shrink-0 flex">
                <button
                    onClick={() => onRemove(toast.id)}
                    className="inline-flex items-center justify-center rounded-md p-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-500 hover:bg-black/5 transition-colors"
                >
                    <span className="sr-only">Close</span>
                    <svg className={`h-5 w-5 ${colors.text}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
        </div>
    );
};


// Portalled to document.body and stacked above every overlay (TOAST_Z).
//
// Three things are load-bearing here:
//  - The PORTAL. The container is a plain descendant of #root; the overlays it
//    has to clear are children of document.body. Raising the number alone works
//    today, but the moment anything above #root gains a `transform`/`filter` it
//    becomes a stacking context and re-traps the toast at any z-index. Portalling
//    makes the fix survive that. (`useToasts()` still resolves — the portal moves
//    the DOM node, not the React parent.)
//  - The POINTER-EVENTS SPLIT. This sits above a full-screen modal, i.e. directly
//    over where Modal renders its close X. The container must not intercept those
//    clicks, so it is inert and each toast opts back in (`pointer-events-auto` on
//    ToastMessage's root).
//  - The WIDTH, below `md`. This used to be `fixed top-4 right-4 w-full max-w-sm`,
//    and on a 360px handheld `w-full` is 360px while `max-w-sm` is 384px — so the
//    cap NEVER engaged and `right-4` placed the box at left:-16px. Every toast was
//    a full-bleed slab hanging off the left edge with its status icon in the dead
//    zone, and at TOAST_Z with pointer-events-auto it also covered the ☰ for the
//    whole 5-8s. `left-2 right-2` is what sizes the box now; `w-full` is gone
//    below `md` and `left-auto` cancels it above.
//
// `top-16` clears the mobile ☰ (`fixed top-4 left-4`, 16→52px) vertically rather
// than horizontally, which keeps the full 344px of width for the message. It also
// clears the 52px mobile top bar that replaces that ☰, so this survives untouched.
//
// The breakpoint is `md`, not `sm`: the sidebar and the ☰ both switch at `md`
// (768px), and a toast must stay in the operator's column on a tablet.
const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToasts();

  return createPortal(
    <div
      className="pointer-events-none fixed top-16 left-2 right-2 flex flex-col gap-2 md:top-4 md:left-auto md:right-4 md:w-full md:max-w-sm md:gap-3"
      style={{ zIndex: TOAST_Z }}
    >
      {toasts.map(toast => (
        <ToastMessage key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>,
    document.body,
  );
};

export default ToastContainer;

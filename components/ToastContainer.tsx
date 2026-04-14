import React from 'react';
import { useToasts } from '../hooks/useToasts';
import { ToastType } from '../types';

const ICONS: Record<ToastType, JSX.Element> = {
  success: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  error: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  info: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
    
    React.useEffect(() => {
        const timer = setTimeout(() => {
            setIsExiting(true);
        }, 4700); // Start exit animation just before removal

        return () => clearTimeout(timer);
    }, []);

    const colors = COLORS[toast.type];

    return (
        <div 
             className={`flex items-start w-full max-w-sm p-4 rounded-xl shadow-lg ring-1 ring-black ring-opacity-5 transition-all duration-300 ease-in-out transform ${colors.bg} ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}`}
             style={{ willChange: 'transform, opacity' }}
        >
            <div className={`flex-shrink-0 ${colors.icon}`}>{ICONS[toast.type]}</div>
            <div className="ml-3 w-0 flex-1 pt-0.5">
                <p className={`text-sm font-medium ${colors.text}`}>{toast.message}</p>
            </div>
            <div className="ml-4 flex-shrink-0 flex">
                <button onClick={() => onRemove(toast.id)} className="inline-flex rounded-md p-1 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-500 hover:bg-black/5 transition-colors">
                    <span className="sr-only">Close</span>
                    <svg className={`h-5 w-5 ${colors.text}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
        </div>
    );
};


const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToasts();

  return (
    <div className="fixed top-4 right-4 z-50 w-full max-w-sm space-y-3">
      {toasts.map(toast => (
        <ToastMessage key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
};

export default ToastContainer;

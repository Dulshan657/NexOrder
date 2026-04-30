import React, { Component } from 'react';
import { reportError } from '../lib/errorReporter';

// React's ErrorInfo (componentStack carrier) is a class-component-only
// concept and isn't typed against React.Component generics, so we model it
// locally rather than importing it.
interface ErrorInfo {
    componentStack: string;
}

interface ErrorBoundaryProps {
    children: React.ReactNode;
    /** Visible label when the boundary fires (e.g. "Admin dashboard"). */
    label?: string;
    /** Render-prop fallback. Receives the captured error and a reset callback. */
    fallback?: (args: { error: Error; reset: () => void; label?: string }) => React.ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

// The project ships without @types/react, so React.Component's instance
// members (this.props/state/setState) come through as `any`. We re-declare
// them on the class so the methods type-check.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    declare props: ErrorBoundaryProps;
    declare state: ErrorBoundaryState;
    declare setState: (next: Partial<ErrorBoundaryState>) => void;

    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { error: null };
        this.reset = this.reset.bind(this);
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        reportError({
            message: error.message,
            stack: error.stack,
            componentStack: info.componentStack,
            metadata: { boundary: this.props.label ?? 'unnamed' },
        });
    }

    reset(): void {
        this.setState({ error: null });
    }

    render(): React.ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;

        const { fallback, label } = this.props;
        if (fallback) return fallback({ error, reset: this.reset, label });

        return <DefaultErrorFallback error={error} reset={this.reset} label={label} />;
    }
}

interface DefaultErrorFallbackProps {
    error: Error;
    reset: () => void;
    label?: string;
}

const DefaultErrorFallback: React.FC<DefaultErrorFallbackProps> = ({ error, reset, label }) => (
    <div
        role="alert"
        className="flex flex-col items-center justify-center w-full min-h-[300px] p-8 text-center"
    >
        <div className="max-w-md">
            <h2 className="text-lg font-semibold text-stone-900 mb-2">
                {label ? `${label} hit a snag` : 'Something went wrong'}
            </h2>
            <p className="text-sm text-stone-600 mb-4">
                The error has been logged. Try again, or refresh the page if it keeps happening.
            </p>
            <details className="text-left text-xs text-stone-500 mb-4 bg-stone-50 rounded p-2">
                <summary className="cursor-pointer">Technical details</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words">{error.message}</pre>
            </details>
            <div className="flex gap-2 justify-center">
                <button
                    type="button"
                    onClick={reset}
                    className="px-4 py-2 text-sm font-medium rounded-md bg-stone-900 text-white hover:bg-stone-800 btn-press"
                >
                    Try again
                </button>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 text-sm font-medium rounded-md bg-white text-stone-900 border border-stone-200 hover:bg-stone-50 btn-press"
                >
                    Reload page
                </button>
            </div>
        </div>
    </div>
);

// Full-page fallback for the top-level boundary in index.tsx.
export const FullPageErrorFallback: ErrorBoundaryProps['fallback'] = ({ error, reset, label }) => (
    <div
        role="alert"
        className="min-h-screen flex items-center justify-center bg-stone-50 p-6"
    >
        <DefaultErrorFallback error={error} reset={reset} label={label} />
    </div>
);

export default ErrorBoundary;

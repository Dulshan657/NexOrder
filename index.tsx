import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from './hooks/useToasts';
import { AuthProvider } from './components/auth/AuthProvider';
import AuthGate from './components/auth/AuthGate';
import { queryClient } from './lib/queryClient';
import ToastContainer from './components/ToastContainer';
import { ErrorBoundary, FullPageErrorFallback } from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/errorReporter';

installGlobalErrorHandlers();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary label="Application" fallback={FullPageErrorFallback}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <AuthGate>
              <App />
            </AuthGate>
            <ToastContainer />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

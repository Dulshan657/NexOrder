import React, { useState } from 'react';
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
import ResetPasswordView, { isRecoveryUrl } from './components/auth/ResetPasswordView';

installGlobalErrorHandlers();

// Top-level switch: when arriving via a Supabase password recovery link
// (URL hash contains type=recovery), render the dedicated reset view
// instead of the normal AuthGate → App tree. After the reset completes,
// flip a one-shot flag so the app falls through to LoginPage.
function Root() {
  const [recovering, setRecovering] = useState<boolean>(() => isRecoveryUrl());

  if (recovering) {
    return <ResetPasswordView onComplete={() => setRecovering(false)} />;
  }

  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
}

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
            <Root />
            <ToastContainer />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

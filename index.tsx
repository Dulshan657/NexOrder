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

// Popup OAuth completion handshake.
//
// When the operator clicks "Connect Gmail" on the Email Accounts tab we
// open a popup pointed at Google's authorize URL. The provider redirects
// to our Supabase callback, which redirects to
// `https://nexorder.vercel.app/admin/email-accounts?connected=1` — but
// the redirect now lands inside the *popup*, not the parent tab. Because
// `lib/supabase.ts` has `persistSession: false`, the popup loads a fresh
// app with no session and would otherwise show the LoginPage.
//
// We short-circuit that here: before React even mounts, detect "I'm in
// a popup window that just finished an OAuth round-trip" and post the
// result back to the opener tab (which still has its in-memory session
// intact). The opener refreshes the mailbox list and toasts the result;
// this popup closes itself.
//
// Falls through to normal rendering if `window.opener` is gone (popup
// blocked → full-tab fallback), the URL doesn't carry the OAuth params,
// or `window.close()` is denied by the browser (rare — only happens when
// the popup wasn't opened via JS in the first place).
(function handlePopupOAuthCompletion() {
  if (typeof window === 'undefined' || !window.opener || window.opener === window) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const connectError = params.get('connect_error');
  if (!connected && !connectError) return;
  try {
    window.opener.postMessage(
      {
        type: 'nexorder-oauth-complete',
        connected: connected === '1',
        error: connectError,
        message: params.get('message'),
        accountId: params.get('account_id'),
      },
      window.location.origin,
    );
  } catch {
    // Best-effort: if postMessage to opener fails (e.g., opener was
    // already closed) just close the popup. The opener can re-fetch
    // on its next focus event anyway.
  }
  window.close();
})();

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

import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from './hooks/useToasts';
import { AuthProvider } from './components/auth/AuthProvider';
import AuthGate from './components/auth/AuthGate';
import { queryClient } from './lib/queryClient';
import ToastContainer from './components/ToastContainer';
import { DocumentViewerProvider } from './context/DocumentViewerContext';
import { ErrorBoundary, FullPageErrorFallback } from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/errorReporter';
import { registerChunkErrorReload } from './lib/lazyWithRetry';
import ResetPasswordView from './components/auth/ResetPasswordView';
import { isAuthLinkUrl } from './lib/auth/recoveryLink';

// Popup OAuth completion handshake.
//
// When the operator clicks "Connect Gmail" on the Email Accounts tab we
// open a popup pointed at Google's authorize URL. The provider chain
// (Google → Supabase callback → /admin/email-accounts?connected=1) lands
// inside the *popup*. Because `lib/supabase.ts` has persistSession:false,
// letting the SPA mount here would render the LoginPage inside the popup.
//
// Detect the OAuth completion via the URL params (always reliable — they
// were written by the Supabase callback) and short-circuit React entirely.
//
// Signaling channels, tried in order:
//   1. BroadcastChannel  — same-origin pub/sub; works even after the
//      cross-origin redirect chain severed `window.opener` (which it
//      reliably does in Chrome's default COOP).
//   2. window.opener.postMessage — fallback for the older browsers that
//      don't expose BroadcastChannel.
// Then attempt window.close(). If the browser denies it, replace the
// document body with a "you can close this window" message so the user
// never sees a stranded LoginPage.

const oauthParams = (typeof window !== 'undefined')
  ? new URLSearchParams(window.location.search)
  : null;
const oauthConnected = oauthParams?.get('connected');
const oauthConnectError = oauthParams?.get('connect_error');
// window.name survives the cross-origin redirect chain within the popup
// and is the cleanest discriminator between "I'm the popup" vs "I'm the
// main tab returning from the popup-blocked fallback". The parent sets
// it to NEXORDER_OAUTH_POPUP_NAME in MailboxesMenu::handleConnect.
const isOAuthPopup = (typeof window !== 'undefined') && window.name === 'nexorder-po-oauth';
const isOAuthPopupCompletion = isOAuthPopup && !!(oauthConnected || oauthConnectError);

if (isOAuthPopupCompletion) {
  const payload = {
    type: 'nexorder-oauth-complete' as const,
    connected: oauthConnected === '1',
    error: oauthConnectError,
    message: oauthParams!.get('message'),
    accountId: oauthParams!.get('account_id'),
  };

  // 1) BroadcastChannel — survives severed openers; same-origin guarantees
  //    only NexOrder windows in this browser can receive.
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel('nexorder-oauth');
      channel.postMessage(payload);
      // Let the message drain before tearing down the channel. 50ms is
      // sub-perceptual and well within the popup-close latency budget.
      setTimeout(() => channel.close(), 50);
    } catch {
      // ignore — fall through to opener path
    }
  }

  // 2) Legacy opener path. Cross-origin redirects usually sever this,
  //    but it's free to attempt and helps on browsers that maintain it.
  if (window.opener && window.opener !== window) {
    try {
      window.opener.postMessage(payload, window.location.origin);
    } catch {
      // ignore
    }
  }

  // Attempt to close. Browsers only honor close() on windows opened via
  // JS — which this one was — but the chain of cross-origin redirects
  // can occasionally invalidate that. If close is denied, render a
  // minimal "all done" UI in place of the React app.
  window.close();
  setTimeout(() => {
    if (!window.closed) {
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#1c1917;background:#fafaf9;">
          <div style="text-align:center;padding:2rem;max-width:24rem;">
            <h1 style="font-size:1.125rem;font-weight:600;margin:0 0 0.5rem;">
              ${oauthConnected === '1' ? 'Mailbox connected' : 'Connection failed'}
            </h1>
            <p style="margin:0;color:#78716c;font-size:0.875rem;line-height:1.5;">
              ${oauthConnected === '1'
                ? "You can close this window — we've returned you to the Email Accounts tab."
                : "You can close this window. The error has been reported to the Email Accounts tab."}
            </p>
          </div>
        </div>
      `;
    }
  }, 100);
}

installGlobalErrorHandlers();

// Recover from "Failed to fetch dynamically imported module" — a stale tab on
// an old deploy whose content-hashed chunks were purged by a newer build. One
// guarded reload pulls a fresh index.html with the current chunk hashes.
registerChunkErrorReload();

// Top-level switch: when arriving via a Supabase password recovery link,
// render the dedicated reset view instead of the normal AuthGate → App tree.
// This covers FAILED links too (expired, already used) — they carry an
// error in the URL, and routing them here is what lets the reason be shown
// instead of a bare login page. After the reset completes, flip a one-shot
// flag so the app falls through to LoginPage.
function Root() {
  const [recovering, setRecovering] = useState<boolean>(() => isAuthLinkUrl());

  if (recovering) {
    return <ResetPasswordView onComplete={() => setRecovering(false)} />;
  }

  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
}

// Skip the React mount when we're a popup completing OAuth — the handshake
// above already wrote a minimal status UI (or closed the window). Rendering
// the SPA on top would re-trigger AuthGate → LoginPage, the very thing this
// whole machinery exists to avoid.
if (!isOAuthPopupCompletion) {
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
              <DocumentViewerProvider>
                <Root />
                <ToastContainer />
              </DocumentViewerProvider>
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import LoginPage from './LoginPage';

/**
 * Top-level gate: shows LoginPage until a session + profile are loaded,
 * then renders the app. Keeps a minimal splash during the initial
 * session-restore tick to avoid flashing the LoginPage for a page reload
 * where the user is already signed in.
 */
const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, isLoading } = useAuth();

  if (isLoading) {
    // First paint of the whole app, so it has to read as Nex Order rather than as
    // a generic spinner. Tile matches the login rail (navy + the same blue wash);
    // the mark is the mono logo inverted to white, the way the rail does it. The
    // stone-50 ground and 100dvh match LoginPage so the swap to it is invisible.
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-nexgen-navy auth-rail-wash rounded-2xl mb-3 p-3 animate-pulse">
            <img
              src="/assets/Nex-Order-no-bg-logo.png"
              alt="Nex Order"
              className="h-full w-auto object-contain"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </div>
          <p className="text-sm text-stone-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <LoginPage />;
  }

  return <>{children}</>;
};

export default AuthGate;

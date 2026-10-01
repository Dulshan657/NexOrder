import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import LoginPage from './LoginPage';

const PRIMARY_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg bg-nexgen-blue-dark px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors btn-press touch-target hover:bg-nexgen-navy disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2';
const SECONDARY_BUTTON =
  'inline-flex items-center rounded-lg px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors touch-target hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2';

/**
 * First paint of the whole app, so it has to read as Nex Order rather than as
 * a generic spinner. Tile matches the login rail (navy + the same blue wash);
 * the mark is the mono logo inverted to white, the way the rail does it. The
 * stone-50 ground and 100dvh match LoginPage so the swap to it is invisible.
 */
const BrandTile: React.FC<{ pulse?: boolean }> = ({ pulse }) => (
  <div className={`inline-flex items-center justify-center w-16 h-16 bg-nexgen-navy auth-rail-wash rounded-2xl mb-3 p-3 ${pulse ? 'animate-pulse' : ''}`}>
    <img
      src="/assets/Nex-Order-no-bg-logo.png"
      alt="Nex Order"
      className="h-full w-auto object-contain"
      style={{ filter: 'brightness(0) invert(1)' }}
    />
  </div>
);

/**
 * A valid session whose profile could not be loaded (network, timeout). Not
 * LoginPage: the user IS signed in, and signing in again would re-run the same
 * failing fetch with no explanation.
 */
const ProfileLoadError: React.FC = () => {
  const { retryProfile, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await retryProfile();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-stone-50 px-4">
      <div className="text-center max-w-sm" role="alert">
        <BrandTile />
        <h1 className="text-base font-semibold text-stone-800">Couldn't load your account</h1>
        <p className="mt-1 text-sm text-stone-600">
          You're still signed in, but we couldn't reach the server. Check your connection and try again.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button type="button" onClick={retry} disabled={retrying} className={PRIMARY_BUTTON}>
            {retrying ? 'Trying…' : 'Try again'}
          </button>
          <button type="button" onClick={() => void signOut()} className={SECONDARY_BUTTON}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Top-level gate: shows LoginPage until a session + profile are loaded,
 * then renders the app. Keeps a minimal splash during the initial
 * session-restore tick to avoid flashing the LoginPage for a page reload
 * where the user is already signed in.
 */
const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, isLoading, profileError } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <BrandTile pulse />
          <p className="text-sm text-stone-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (user && !profile && profileError) {
    return <ProfileLoadError />;
  }

  if (!user || !profile) {
    return <LoginPage />;
  }

  return <>{children}</>;
};

export default AuthGate;

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
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-stone-800 rounded-2xl mb-3 animate-pulse">
            <span className="text-white text-xl font-bold font-display">A</span>
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

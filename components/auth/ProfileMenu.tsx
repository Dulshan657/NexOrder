import React, { useState } from 'react';
import type { User } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { LogOut, Lock, ChevronUp, ChevronDown } from 'lucide-react';
import OptimizedImage from '../OptimizedImage';
import { MODULE_SHOP } from '../../lib/modules';
import { lockKitchen } from '../../lib/qr/qrSessionEnd';
import { formatClockTime } from '../../lib/qr/qrPinMessages';

interface KitchenSession {
  /** When the 2-hour unlock ends; null until it has loaded. */
  endsAt: Date | null;
}

interface ProfileMenuProps {
  currentUser: User;
  /**
   * Set for a kitchen (QR Staff) login. That login has no account to manage and
   * no password to sign out of: the menu shows whose session this is and when it
   * ends, and its one action is Lock -- back to the venue's PIN pad, so the next
   * person at the bench types their own PIN.
   */
  kitchenSession?: KitchenSession;
}

const KitchenProfile: React.FC<{ currentUser: User; session: KitchenSession }> = ({ currentUser, session }) => {
  const [locking, setLocking] = useState(false);
  const ends = formatClockTime(session.endsAt);

  const lock = async () => {
    setLocking(true);
    try {
      await lockKitchen();
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="border-t border-stone-200">
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          aria-hidden="true"
          className="w-8 h-8 rounded-xl bg-nexgen-blue-dark flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
        >
          {currentUser.name.charAt(0)}
        </div>
        {/* Two lines, and neither is cut off: the sidebar is narrow, and a truncated
            "Ends 14:3…" is worse than a name that wraps. Who it is on top, when it
            stops below. */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-stone-900 break-words">{`Kitchen session · ${currentUser.name}`}</p>
          {ends && <p className="text-xs text-stone-600">{`Ends ${ends}`}</p>}
        </div>
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={lock}
          disabled={locking}
          className="w-full flex items-center gap-2 px-3 py-2 touch-target-y rounded-lg text-sm font-medium text-stone-800 bg-stone-100 hover:bg-stone-200 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark"
        >
          <Lock className="w-4 h-4" aria-hidden="true" />
          {locking ? 'Locking…' : 'Lock'}
        </button>
      </div>
    </div>
  );
};

const ProfileMenu: React.FC<ProfileMenuProps> = ({ currentUser, kitchenSession }) => {
  const { signOut } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // `MODULE_SHOP` is a build constant: on a tenant without the Shop no kitchen
  // login exists, and this branch -- with the QR client behind it -- is not shipped.
  if (MODULE_SHOP && kitchenSession) {
    return <KitchenProfile currentUser={currentUser} session={kitchenSession} />;
  }

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="border-t border-stone-200">
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-100 transition-colors cursor-pointer"
      >
        {currentUser.avatarUrl ? (
          <OptimizedImage src={currentUser.avatarUrl} alt={currentUser.name} className="w-8 h-8 rounded-xl flex-shrink-0" transformWidth={128} />
        ) : (
          <div className="w-8 h-8 rounded-xl bg-nexgen-blue flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
            {currentUser.name.charAt(0)}
          </div>
        )}
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-stone-900 truncate">{currentUser.name}</p>
          <p className="text-xs text-stone-500 truncate">{currentUser.role}</p>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-stone-500 flex-shrink-0" />
        ) : (
          <ChevronUp className="w-4 h-4 text-stone-500 flex-shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-stone-700 hover:bg-stone-100 hover:text-red-600 transition-colors disabled:opacity-60"
          >
            <LogOut className="w-4 h-4" />
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ProfileMenu;

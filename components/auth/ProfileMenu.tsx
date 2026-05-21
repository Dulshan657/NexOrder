import React, { useState } from 'react';
import type { User } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { LogOut, ChevronUp, ChevronDown } from 'lucide-react';
import OptimizedImage from '../OptimizedImage';

interface ProfileMenuProps {
  currentUser: User;
}

const ProfileMenu: React.FC<ProfileMenuProps> = ({ currentUser }) => {
  const { signOut } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

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
          <ChevronDown className="w-4 h-4 text-stone-400 flex-shrink-0" />
        ) : (
          <ChevronUp className="w-4 h-4 text-stone-400 flex-shrink-0" />
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

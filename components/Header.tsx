import React from 'react';
import { User } from '../types';
import OptimizedImage from './OptimizedImage';

interface HeaderProps {
    currentUser: User;
    onOpenProfile: () => void;
    logoUrl?: string | null;
    onMenuClick?: () => void;
}

const Header: React.FC<HeaderProps> = ({ currentUser, onOpenProfile, logoUrl, onMenuClick }) => {
  return (
    <header className="bg-white border-b border-stone-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
                {onMenuClick && (
                    <button onClick={onMenuClick} className="md:hidden p-2 -ml-2 text-stone-500 hover:text-stone-900 focus:outline-none">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                )}
           </div>
           <div className="flex items-center space-x-5">
                <div className="text-right hidden sm:block">
                    <p className="font-medium text-stone-900 text-sm">{currentUser.name}</p>
                    <p className="text-xs text-stone-500 uppercase tracking-wider mt-0.5">{currentUser.role}</p>
                </div>
                <button onClick={onOpenProfile} className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-600 rounded-full transition-transform hover:scale-105">
                    <OptimizedImage
                        src={currentUser.avatarUrl || `https://i.pravatar.cc/150?u=${currentUser.id}`}
                        alt="User avatar"
                        className="h-10 w-10 rounded-full border border-stone-200"
                        transformWidth={96}
                    />
                </button>
           </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
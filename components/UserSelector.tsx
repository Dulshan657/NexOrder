import React, { useState } from 'react';
import { User } from '../types';
import { ChevronUp, ChevronDown } from 'lucide-react';
import OptimizedImage from './OptimizedImage';

interface UserSelectorProps {
  users: User[];
  currentUser: User;
  onSelectUser: (user: User) => void;
}

const UserSelector: React.FC<UserSelectorProps> = ({ users, currentUser, onSelectUser }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-t border-stone-200">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
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
        <div className="px-3 pb-3 space-y-1">
          <p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">Switch Account</p>
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => { onSelectUser(user); setIsExpanded(false); }}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                user.id === currentUser.id
                  ? 'bg-nexgen-blue/10 text-nexgen-blue'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              {user.avatarUrl ? (
                <OptimizedImage src={user.avatarUrl} alt={user.name} className="w-6 h-6 rounded-xl flex-shrink-0" transformWidth={96} />
              ) : (
                <div className="w-6 h-6 rounded-xl bg-stone-200 flex items-center justify-center text-xs font-semibold text-stone-600 flex-shrink-0">
                  {user.name.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className={`text-[10px] truncate ${user.id === currentUser.id ? 'text-nexgen-blue/70' : 'text-stone-500'}`}>{user.role}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserSelector;

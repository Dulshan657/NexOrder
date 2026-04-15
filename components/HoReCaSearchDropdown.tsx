import React, { useState, useRef, useEffect } from 'react';
import type { HoReCa, User } from '../types';
import { UserRole } from '../types';
import { Search, ChevronDown, Building2 } from 'lucide-react';

interface HoReCaSearchDropdownProps {
  hoReCas: HoReCa[];
  selectedHoReCaId: number | null;
  onSelectHoReCa: (hoReCaId: number) => void;
  currentUser: User;
  error?: string;
}

const HoReCaSearchDropdown: React.FC<HoReCaSearchDropdownProps> = ({
  hoReCas,
  selectedHoReCaId,
  onSelectHoReCa,
  currentUser,
  error,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const canSelect =
    currentUser.role === UserRole.FIELD_REP ||
    currentUser.role === UserRole.OFFICE_REP ||
    currentUser.role === UserRole.ADMIN ||
    currentUser.role === UserRole.MANAGER;
  const isCustomer = currentUser.role === UserRole.CUSTOMER;

  const selectedHoReCa = hoReCas.find(h => h.id === selectedHoReCaId);

  const filtered = query.trim()
    ? hoReCas.filter(h => h.name.toLowerCase().includes(query.toLowerCase()))
    : hoReCas;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isCustomer) {
    const name = hoReCas.find(h => h.id === currentUser.hoReCaId)?.name ?? 'Unknown';
    return (
      <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
        <Building2 className="w-4 h-4 text-stone-400" />
        <span className="text-sm font-medium text-stone-700">{name}</span>
      </div>
    );
  }

  if (!canSelect) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors min-w-[200px] ${
          error
            ? 'border-red-400 bg-red-50 text-red-700'
            : selectedHoReCa
              ? 'border-stone-200 bg-white text-stone-900 hover:border-stone-300'
              : 'border-stone-300 bg-stone-50 text-stone-500 hover:border-stone-400'
        }`}
      >
        <Building2 className="w-4 h-4 text-stone-400 flex-shrink-0" />
        <span className="flex-1 text-left truncate font-medium">
          {selectedHoReCa?.name ?? 'Select HoReCa'}
        </span>
        <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-stone-200 rounded-xl shadow-elevated z-50 overflow-hidden">
          <div className="p-2 border-b border-stone-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search HoReCa..."
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-stone-50 border-0 ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-nexgen-blue placeholder:text-stone-400"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setIsOpen(false); setQuery(''); }
                }}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-stone-400 text-center">No matches found</p>
            ) : (
              filtered.map(h => (
                <button
                  key={h.id}
                  onClick={() => {
                    onSelectHoReCa(h.id);
                    setIsOpen(false);
                    setQuery('');
                  }}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                    h.id === selectedHoReCaId
                      ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium'
                      : 'text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  <span className="block truncate">{h.name}</span>
                  {h.address && (
                    <span className="block text-xs text-stone-400 truncate mt-0.5">{h.address}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HoReCaSearchDropdown;

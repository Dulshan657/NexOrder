import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronUp, X, Clock, UserPlus, CheckCircle, ArrowRight } from 'lucide-react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { User } from '../types';
import { UserRole } from '../types';

// ---------------------------------------------------------------------------
// Exported type definitions
// ---------------------------------------------------------------------------

type AlertSeverity = 'critical' | 'warning' | 'info';

export interface ActionItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: { label: string; color: string };
  onClick?: () => void;
  actions?: {
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    variant?: 'default' | 'primary' | 'danger';
  }[];
}

export interface ActionItemColumn {
  id: string;
  label: string;
  icon: LucideIcon;
  severity: AlertSeverity;
  items: ActionItem[];
  onViewAll?: () => void;
}

interface ActionItemsBoardProps {
  title: string;
  columns: ActionItemColumn[];
  storageKey: string;
  users?: User[];
  showAssign?: boolean;
}

// ---------------------------------------------------------------------------
// Persisted board state
// ---------------------------------------------------------------------------

interface BoardState {
  collapsed: boolean;
  dismissed: string[];
  snoozed: Record<string, string>;
  assignments: Record<string, number>;
}

const defaultBoardState: BoardState = {
  collapsed: true,
  dismissed: [],
  snoozed: {},
  assignments: {},
};

// ---------------------------------------------------------------------------
// Severity style maps
// ---------------------------------------------------------------------------

const severityBorderLeft: Record<AlertSeverity, string> = {
  critical: 'border-l-4 border-l-red-500',
  warning: 'border-l-4 border-l-amber-500',
  info: 'border-l-4 border-l-blue-500',
};

const severityBadgeBg: Record<AlertSeverity, string> = {
  critical: 'bg-red-500 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-blue-500 text-white',
};

const severityIconColor: Record<AlertSeverity, string> = {
  critical: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

// ---------------------------------------------------------------------------
// SnoozeButton
// ---------------------------------------------------------------------------

interface SnoozeButtonProps {
  itemId: string;
  onSnooze: (itemId: string, expiryIso: string) => void;
}

const SNOOZE_OPTIONS: { label: string; days: number }[] = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
];

const SnoozeButton: React.FC<SnoozeButtonProps> = ({ itemId, onSnooze }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  function handleSelect(days: number): void {
    const expiry = new Date(Date.now() + days * 86_400_000).toISOString();
    onSnooze(itemId, expiry);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev); }}
        className="text-[10px] text-stone-400 hover:text-amber-500 flex items-center gap-0.5"
      >
        <Clock className="w-3 h-3" />
        Snooze
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[100px]"
          onClick={(e) => e.stopPropagation()}
        >
          {SNOOZE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => handleSelect(opt.days)}
              className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// AssignButton
// ---------------------------------------------------------------------------

const REP_ROLES: UserRole[] = [UserRole.FIELD_REP, UserRole.OFFICE_REP];

interface AssignButtonProps {
  itemId: string;
  users: User[];
  currentAssigneeId?: number;
  onAssign: (itemId: string, userId: number) => void;
}

const AssignButton: React.FC<AssignButtonProps> = ({ itemId, users, currentAssigneeId, onAssign }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const repUsers = users.filter((u) => REP_ROLES.includes(u.role));

  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const currentAssignee = currentAssigneeId !== undefined
    ? users.find((u) => u.id === currentAssigneeId)
    : undefined;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const userId = Number(e.target.value);
    if (!Number.isNaN(userId)) {
      onAssign(itemId, userId);
      setOpen(false);
    }
  }

  if (currentAssignee) {
    return (
      <span className="text-[10px] text-stone-400 flex items-center gap-0.5">
        <UserPlus className="w-3 h-3" />
        {currentAssignee.name}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev); }}
        className="text-[10px] text-stone-400 hover:text-blue-500 flex items-center gap-0.5"
      >
        <UserPlus className="w-3 h-3" />
        Assign
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 bg-white border border-stone-200 rounded-lg shadow-lg p-1 min-w-[140px]"
          onClick={(e) => e.stopPropagation()}
        >
          <select
            size={Math.min(repUsers.length + 1, 6)}
            className="w-full text-xs text-stone-700 border-none outline-none bg-transparent"
            onChange={handleChange}
            defaultValue=""
          >
            <option value="" disabled>Select rep...</option>
            {repUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ActionItemRow
// ---------------------------------------------------------------------------

interface ActionItemRowProps {
  item: ActionItem;
  showAssign: boolean;
  users: User[];
  assigneeId?: number;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, expiry: string) => void;
  onAssign: (id: string, userId: number) => void;
}

const ActionItemRow: React.FC<ActionItemRowProps> = ({
  item,
  showAssign,
  users,
  assigneeId,
  onDismiss,
  onSnooze,
  onAssign,
}) => {
  return (
    <div
      onClick={item.onClick}
      className={`group px-4 py-2.5 hover:bg-stone-50 border-b border-stone-100 last:border-b-0 ${item.onClick ? 'cursor-pointer' : ''}`}
    >
      {/* Main row content */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm text-stone-800 truncate">{item.title}</span>
          {item.badge && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${item.badge.color}`}>
              {item.badge.label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {item.subtitle && (
            <span className="text-xs text-stone-500">{item.subtitle}</span>
          )}
          {item.actions?.map((action) => {
            const variantClass =
              action.variant === 'primary'
                ? 'text-blue-600 hover:text-blue-800'
                : action.variant === 'danger'
                ? 'text-red-500 hover:text-red-700'
                : 'text-stone-500 hover:text-stone-800';

            return (
              <button
                key={action.label}
                type="button"
                onClick={(e) => { e.stopPropagation(); action.onClick(); }}
                className={`text-xs font-medium ${variantClass} flex items-center gap-0.5`}
              >
                <action.icon className="w-3 h-3" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* System actions — shown on hover */}
      <div className="hidden group-hover:flex items-center gap-2 mt-1.5 pt-1.5 border-t border-stone-100">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(item.id); }}
          className="text-[10px] text-stone-400 hover:text-red-500 flex items-center gap-0.5"
        >
          <X className="w-3 h-3" />
          Dismiss
        </button>

        <SnoozeButton itemId={item.id} onSnooze={onSnooze} />

        {showAssign && users.length > 0 && (
          <AssignButton
            itemId={item.id}
            users={users}
            currentAssigneeId={assigneeId}
            onAssign={onAssign}
          />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Single column
// ---------------------------------------------------------------------------

interface ColumnPanelProps {
  column: ActionItemColumn;
  visibleItems: ActionItem[];
  showAssign: boolean;
  users: User[];
  assignments: Record<string, number>;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, expiry: string) => void;
  onAssign: (id: string, userId: number) => void;
}

const ColumnPanel: React.FC<ColumnPanelProps> = ({
  column,
  visibleItems,
  showAssign,
  users,
  assignments,
  onDismiss,
  onSnooze,
  onAssign,
}) => {
  const Icon = column.icon;

  return (
    <div className={`flex flex-col ${severityBorderLeft[column.severity]}`}>
      {/* Column header */}
      <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2">
        <Icon className={`w-4 h-4 shrink-0 ${severityIconColor[column.severity]}`} />
        <span className="text-xs font-semibold text-stone-700 uppercase tracking-wide">
          {column.label}
        </span>
        {visibleItems.length > 0 && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto ${severityBadgeBg[column.severity]}`}>
            {visibleItems.length}
          </span>
        )}
      </div>

      {/* Scrollable item list */}
      <div className="max-h-[300px] overflow-y-auto action-items-scroll flex-1">
        {visibleItems.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-stone-400">No items</div>
        ) : (
          visibleItems.map((item) => (
            <ActionItemRow
              key={item.id}
              item={item}
              showAssign={showAssign}
              users={users}
              assigneeId={assignments[item.id]}
              onDismiss={onDismiss}
              onSnooze={onSnooze}
              onAssign={onAssign}
            />
          ))
        )}
      </div>

      {/* Column footer */}
      {column.onViewAll && (
        <div className="border-t border-stone-100">
          <button
            type="button"
            onClick={column.onViewAll}
            className="w-full text-left text-xs text-blue-600 hover:text-blue-800 px-4 py-2 flex items-center gap-1 font-medium"
          >
            View All
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const ActionItemsBoard: React.FC<ActionItemsBoardProps> = ({
  title,
  columns,
  storageKey,
  users = [],
  showAssign = false,
}) => {
  const [state, setState] = useLocalStorage<BoardState>(storageKey, defaultBoardState);

  const now = new Date().toISOString();

  /** Filter items for a column based on dismissed/snoozed state */
  const getVisibleItems = useCallback(
    (items: ActionItem[]): ActionItem[] =>
      items.filter((item) => {
        if (state.dismissed.includes(item.id)) return false;
        const snoozeExpiry = state.snoozed[item.id];
        if (snoozeExpiry && snoozeExpiry > now) return false;
        return true;
      }),
    [state.dismissed, state.snoozed, now],
  );

  const visibleItemsByColumn = columns.map((col) => ({
    column: col,
    items: getVisibleItems(col.items),
  }));

  const totalVisible = visibleItemsByColumn.reduce((sum, { items }) => sum + items.length, 0);

  // ---------------------------------------------------------------------------
  // State updaters — all immutable
  // ---------------------------------------------------------------------------

  function handleToggleCollapse(): void {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }

  function handleDismiss(itemId: string): void {
    setState((prev) => ({
      ...prev,
      dismissed: prev.dismissed.includes(itemId)
        ? prev.dismissed
        : [...prev.dismissed, itemId],
    }));
  }

  function handleSnooze(itemId: string, expiryIso: string): void {
    setState((prev) => ({
      ...prev,
      snoozed: { ...prev.snoozed, [itemId]: expiryIso },
    }));
  }

  function handleAssign(itemId: string, userId: number): void {
    setState((prev) => ({
      ...prev,
      assignments: { ...prev.assignments, [itemId]: userId },
    }));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      {/* Title bar — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleToggleCollapse}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleToggleCollapse(); }}
        className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-stone-50 transition-colors duration-150 select-none"
        aria-expanded={!state.collapsed}
      >
        {/* Left: icon + title + total badge */}
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-stone-800">{title}</span>
          {totalVisible > 0 && (
            <span className="text-[11px] font-bold bg-stone-700 text-white px-2 py-0.5 rounded-full">
              {totalVisible}
            </span>
          )}
        </div>

        {/* Right: collapse toggle */}
        {state.collapsed ? (
          <ChevronDown className="w-4 h-4 text-stone-400" />
        ) : (
          <ChevronUp className="w-4 h-4 text-stone-400" />
        )}
      </div>

      {/* Collapsible body */}
      {!state.collapsed && (
        <div className="border-t border-stone-200 transition-all duration-200">
          {totalVisible === 0 ? (
            // All-clear state
            <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 text-emerald-700 text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              All clear — no action items right now.
            </div>
          ) : (
            // Column grid
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-stone-200">
              {visibleItemsByColumn.map(({ column, items }) => (
                <ColumnPanel
                  key={column.id}
                  column={column}
                  visibleItems={items}
                  showAssign={showAssign}
                  users={users}
                  assignments={state.assignments}
                  onDismiss={handleDismiss}
                  onSnooze={handleSnooze}
                  onAssign={handleAssign}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ActionItemsBoard;

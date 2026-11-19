import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, X, Clock, UserPlus, CheckCircle, ArrowRight, ChevronRight } from 'lucide-react';
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
// Persisted board state. The SHAPE and the storage keys callers pass
// (`admin_action_items`, `rep_action_items`) are what an operator's dismissed
// and snoozed items live under — changing either silently resurrects them.
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
// Severity style maps. Colour is a small dot and a count; the panel stays calm.
// ---------------------------------------------------------------------------

const severityDot: Record<AlertSeverity, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-nexgen-blue',
};

const severityCount: Record<AlertSeverity, string> = {
  critical: 'bg-red-50 text-red-700',
  warning: 'bg-amber-50 text-amber-800',
  info: 'bg-nexgen-blue-light text-nexgen-blue-dark',
};

const severityIconColor: Record<AlertSeverity, string> = {
  critical: 'text-red-600',
  warning: 'text-amber-600',
  info: 'text-nexgen-blue-dark',
};

// Small icon buttons for the per-row housekeeping. Always present in the DOM and
// in the tab order; on a pointer device they fade in on row hover or focus, and
// on touch (no hover) they are simply visible.
const housekeepingBtn =
  'inline-flex items-center justify-center rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 transition-colors duration-150 cursor-pointer touch-target';

// ---------------------------------------------------------------------------
// useOutsideClose — one popover helper for Snooze and Assign
// ---------------------------------------------------------------------------

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, close]);
  return ref;
}

// ---------------------------------------------------------------------------
// SnoozeButton
// ---------------------------------------------------------------------------

interface SnoozeButtonProps {
  itemId: string;
  itemTitle: string;
  onSnooze: (itemId: string, expiryIso: string) => void;
}

const SNOOZE_OPTIONS: { label: string; days: number }[] = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
];

const SnoozeButton: React.FC<SnoozeButtonProps> = ({ itemId, itemTitle, onSnooze }) => {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);

  function handleSelect(days: number): void {
    const expiry = new Date(Date.now() + days * 86_400_000).toISOString();
    onSnooze(itemId, expiry);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Snooze ${itemTitle}`}
        aria-expanded={open}
        title="Snooze"
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev); }}
        className={housekeepingBtn}
      >
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-50 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[112px]"
          onClick={(e) => e.stopPropagation()}
        >
          {SNOOZE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => handleSelect(opt.days)}
              className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 touch-target-y"
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
  itemTitle: string;
  users: User[];
  currentAssigneeId?: number;
  onAssign: (itemId: string, userId: number) => void;
}

const AssignButton: React.FC<AssignButtonProps> = ({ itemId, itemTitle, users, currentAssigneeId, onAssign }) => {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);
  const repUsers = users.filter((u) => REP_ROLES.includes(u.role));

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
      <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-700">
        <UserPlus className="w-3 h-3" aria-hidden="true" />
        {currentAssignee.name}
      </span>
    );
  }

  if (repUsers.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Assign ${itemTitle}`}
        aria-expanded={open}
        title="Assign"
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev); }}
        className={housekeepingBtn}
      >
        <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-50 bg-white border border-stone-200 rounded-lg shadow-lg p-1 min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          <select
            aria-label={`Assign ${itemTitle} to`}
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

function RowText({ item }: { item: ActionItem }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2 min-w-0">
        <span className="truncate text-sm text-stone-800">{item.title}</span>
        {item.badge && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded-md border shrink-0 ${item.badge.color}`}>
            {item.badge.label}
          </span>
        )}
      </span>
      {item.subtitle && <span className="block truncate text-xs text-stone-500 mt-0.5">{item.subtitle}</span>}
    </span>
  );
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
    <div className="group flex items-center gap-1 px-2 py-1 border-b border-stone-100 last:border-b-0 hover:bg-stone-50/70 transition-colors duration-150">
      {/* The row's destination. A row with nowhere to go is plain text, not a button. */}
      {item.onClick ? (
        <button
          type="button"
          onClick={item.onClick}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left cursor-pointer touch-target-y"
        >
          <RowText item={item} />
          <ChevronRight
            className="w-4 h-4 shrink-0 text-stone-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
          <RowText item={item} />
        </div>
      )}

      {item.actions?.map((action) => {
        const variantClass =
          action.variant === 'danger'
            ? 'text-red-700 hover:bg-red-50'
            : 'text-nexgen-blue-dark hover:bg-nexgen-blue-light';

        return (
          <button
            key={action.label}
            type="button"
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${variantClass} transition-colors duration-150 cursor-pointer touch-target-y`}
          >
            {action.label}
            <action.icon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        );
      })}

      {/* Housekeeping: always in the tab order, revealed on hover/focus on desktop. */}
      <div className="flex shrink-0 items-center gap-0.5 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        {showAssign && users.length > 0 && (
          <AssignButton
            itemId={item.id}
            itemTitle={item.title}
            users={users}
            currentAssigneeId={assigneeId}
            onAssign={onAssign}
          />
        )}
        <SnoozeButton itemId={item.id} itemTitle={item.title} onSnooze={onSnooze} />
        <button
          type="button"
          aria-label={`Dismiss ${item.title}`}
          title="Dismiss"
          onClick={(e) => { e.stopPropagation(); onDismiss(item.id); }}
          className={housekeepingBtn}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
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
    <div className="flex flex-col min-w-0">
      {/* Column header */}
      <div className="px-4 py-3 flex items-center gap-2">
        <Icon className={`w-4 h-4 shrink-0 ${severityIconColor[column.severity]}`} aria-hidden="true" />
        <span className="text-[13px] font-semibold text-stone-800 truncate">{column.label}</span>
        {visibleItems.length > 0 && (
          <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${severityCount[column.severity]}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${severityDot[column.severity]}`} aria-hidden="true" />
            {visibleItems.length}
          </span>
        )}
      </div>

      {/* Scrollable item list */}
      <div className="max-h-[300px] overflow-y-auto action-items-scroll flex-1 border-t border-stone-100">
        {visibleItems.length === 0 ? (
          <div className="flex items-center justify-center gap-1.5 px-4 py-6 text-xs text-stone-500">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            Nothing here
          </div>
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
        <div className="border-t border-stone-100 px-2 py-1">
          <button
            type="button"
            onClick={column.onViewAll}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-nexgen-blue-dark hover:bg-stone-50 transition-colors duration-150 cursor-pointer touch-target-y"
          >
            View all
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
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
  const criticalVisible = visibleItemsByColumn
    .filter(({ column }) => column.severity === 'critical')
    .reduce((sum, { items }) => sum + items.length, 0);

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

  const bodyId = `${storageKey}-body`;

  return (
    <section className="dash-card overflow-hidden">
      {/* Title bar — always visible */}
      <button
        type="button"
        onClick={handleToggleCollapse}
        aria-expanded={!state.collapsed}
        aria-controls={bodyId}
        className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-stone-50/70 transition-colors duration-150"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-semibold text-stone-900">{title}</span>
          {totalVisible > 0 ? (
            <span className="text-xs text-stone-600 tabular-nums">
              {totalVisible} open
              {criticalVisible > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
                  {criticalVisible} urgent
                </span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
              All clear
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-stone-500 transition-transform duration-200 ${state.collapsed ? '' : 'rotate-180'}`}
          aria-hidden="true"
        />
      </button>

      {/* Collapsible body */}
      {!state.collapsed && (
        <div id={bodyId} className="border-t border-stone-200/80">
          {totalVisible === 0 ? (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-stone-600">
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" aria-hidden="true" />
              Nothing needs your attention right now.
            </div>
          ) : (
            <div className={`grid grid-cols-1 divide-y sm:divide-y-0 sm:divide-x divide-stone-100 ${columns.length >= 3 ? 'sm:grid-cols-3' : columns.length === 2 ? 'sm:grid-cols-2' : ''}`}>
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
    </section>
  );
};

export default ActionItemsBoard;

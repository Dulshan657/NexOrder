import React from 'react';

export type SidebarNavBadge = {
    count: number;
    /** Background colour only. The shape is shared so badges line up. */
    colorClass: string;
};

type SidebarNavItemProps = {
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    /** Left undefined by a row that opens a sheet rather than a screen. */
    active?: boolean;
    badge?: SidebarNavBadge;
    children: React.ReactNode;
};

/**
 * One sidebar row. Every row in AppShell's nav goes through here, so the icon
 * column, label column and badge column are the same on all of them.
 *
 * `truncate` is a backstop: labels are expected to fit, and a wrapped label
 * breaks the row rhythm far more visibly than an ellipsis would.
 */
const SidebarNavItem = ({ icon: Icon, onClick, active, badge, children }: SidebarNavItemProps) => (
    <button
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 w-full px-3 py-2.5 touch-target-y rounded-lg text-sm btn-press ${active ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
    >
        <Icon className="w-5 h-5 shrink-0" />
        <span className="flex-1 min-w-0 truncate text-left">{children}</span>
        {badge && badge.count > 0 && (
            <span className={`shrink-0 ml-2 min-w-[18px] text-[10px] font-bold rounded-full px-1.5 py-0.5 text-center text-white ${badge.colorClass}`}>
                {badge.count}
            </span>
        )}
    </button>
);

export default SidebarNavItem;

import React, { useMemo, useState } from 'react';
import type { SalesTarget, SalesTargetType } from '../types';
import { Target, DollarSign, ShoppingBag, Users } from 'lucide-react';
import { Button, Modal } from './ui';

interface SalesTargetModalProps {
    isOpen: boolean;
    onClose: () => void;
    existingTargets: SalesTarget[];
    userId: number;
    onSave: (targets: SalesTarget[]) => void;
}

interface TargetField {
    type: SalesTargetType;
    label: string;
    icon: React.ReactNode;
    placeholder: string;
    prefix?: string;
}

interface TargetFieldState {
    value: string;
    startDate: string;
    endDate: string;
    enabled: boolean;
}

const TARGET_FIELDS: TargetField[] = [
    { type: 'revenue', label: 'Revenue Target', icon: <DollarSign className="w-5 h-5" />, placeholder: 'e.g. 50000', prefix: '$' },
    { type: 'orders', label: 'Orders Target', icon: <ShoppingBag className="w-5 h-5" />, placeholder: 'e.g. 30' },
    { type: 'new_horecas', label: 'New HoReCa Target', icon: <Users className="w-5 h-5" />, placeholder: 'e.g. 5' },
];

const TARGET_TYPES: SalesTargetType[] = TARGET_FIELDS.map(f => f.type);

const formatDateForInput = (date: Date): string => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const SalesTargetModal: React.FC<SalesTargetModalProps> = ({ isOpen, onClose, existingTargets, userId, onSave }) => {
    const userTargets = existingTargets.filter(t => t.userId === userId);

    const getExisting = (type: SalesTargetType): SalesTarget | undefined =>
        userTargets.find(t => t.type === type);

    const defaultStart = formatDateForInput(new Date());
    const defaultEnd = formatDateForInput(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));

    // Captured once, so the dirty guard compares against what the operator was first shown.
    const [initial] = useState<Record<SalesTargetType, TargetFieldState>>(() => {
        const state: Record<SalesTargetType, TargetFieldState> = {
            revenue: { value: '', startDate: defaultStart, endDate: defaultEnd, enabled: false },
            orders: { value: '', startDate: defaultStart, endDate: defaultEnd, enabled: false },
            new_horecas: { value: '', startDate: defaultStart, endDate: defaultEnd, enabled: false },
        };

        for (const type of TARGET_TYPES) {
            const existing = getExisting(type);
            if (existing) {
                state[type] = {
                    value: String(existing.targetValue),
                    startDate: existing.startDate,
                    endDate: existing.endDate,
                    enabled: true,
                };
            }
        }

        return state;
    });

    const [formState, setFormState] = useState(initial);

    const isDirty = useMemo(
        () =>
            TARGET_TYPES.some(type => {
                const field = formState[type];
                const base = initial[type];
                return (
                    field.value !== base.value ||
                    field.startDate !== base.startDate ||
                    field.endDate !== base.endDate ||
                    field.enabled !== base.enabled
                );
            }),
        [formState, initial],
    );

    const updateField = (type: SalesTargetType, field: string, value: string | boolean) => {
        setFormState(prev => ({
            ...prev,
            [type]: { ...prev[type], [field]: value },
        }));
    };

    const handleSave = () => {
        const now = new Date().toISOString();
        const otherTargets = existingTargets.filter(t => t.userId !== userId);
        const newTargets: SalesTarget[] = [];

        for (const type of TARGET_TYPES) {
            const field = formState[type];
            if (!field.enabled || !field.value || Number(field.value) <= 0) continue;

            const existing = getExisting(type);
            newTargets.push({
                id: existing?.id ?? `TGT-${Date.now()}-${type}`,
                userId,
                type,
                targetValue: Number(field.value),
                startDate: field.startDate,
                endDate: field.endDate,
                createdAt: existing?.createdAt ?? now,
            });
        }

        onSave([...otherTargets, ...newTargets]);
        onClose();
    };

    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            dirty={isDirty}
            icon={<Target className="w-4 h-4 text-nexgen-blue" />}
            title="Set Sales Targets"
            description="Define your goals with custom date ranges"
            footer={({ requestClose }) => (
                <>
                    <Button variant="secondary" onClick={requestClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave}>Save Targets</Button>
                </>
            )}
        >
            <div className="space-y-6">
                {TARGET_FIELDS.map(({ type, label, icon, placeholder, prefix }) => {
                    const field = formState[type];
                    return (
                        <div key={type} className={`rounded-xl border p-4 transition-colors ${field.enabled ? 'border-emerald-300 bg-emerald-50/30' : 'border-stone-200 bg-stone-50'}`}>
                            <label className="flex items-center gap-3 cursor-pointer mb-3">
                                <input
                                    type="checkbox"
                                    checked={field.enabled}
                                    onChange={e => updateField(type, 'enabled', e.target.checked)}
                                    className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${field.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-200 text-stone-600'}`}>
                                    {icon}
                                </div>
                                <span className={`font-semibold ${field.enabled ? 'text-stone-900' : 'text-stone-500'}`}>{label}</span>
                            </label>

                            {field.enabled && (
                                <div className="space-y-3 ml-7">
                                    <div>
                                        <label className="block text-xs font-medium text-stone-500 mb-1">Target Value</label>
                                        <div className="relative">
                                            {prefix && (
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 font-medium">{prefix}</span>
                                            )}
                                            <input
                                                type="number"
                                                min="1"
                                                value={field.value}
                                                onChange={e => updateField(type, 'value', e.target.value)}
                                                placeholder={placeholder}
                                                className={`w-full border border-stone-300 rounded-lg py-2 ${prefix ? 'pl-7' : 'pl-3'} pr-3 text-stone-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500`}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-stone-500 mb-1">Start Date</label>
                                            <input
                                                type="date"
                                                value={field.startDate}
                                                onChange={e => updateField(type, 'startDate', e.target.value)}
                                                className="w-full border border-stone-300 rounded-lg py-2 px-3 text-stone-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-stone-500 mb-1">End Date</label>
                                            <input
                                                type="date"
                                                value={field.endDate}
                                                onChange={e => updateField(type, 'endDate', e.target.value)}
                                                className="w-full border border-stone-300 rounded-lg py-2 px-3 text-stone-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
};

export default SalesTargetModal;

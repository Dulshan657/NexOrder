import React, { useState } from 'react';
import type { SalesTarget, SalesTargetType } from '../types';
import { Target, X, DollarSign, ShoppingBag, Users } from 'lucide-react';

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

const TARGET_FIELDS: TargetField[] = [
    { type: 'revenue', label: 'Revenue Target', icon: <DollarSign className="w-5 h-5" />, placeholder: 'e.g. 50000', prefix: '$' },
    { type: 'orders', label: 'Orders Target', icon: <ShoppingBag className="w-5 h-5" />, placeholder: 'e.g. 30' },
    { type: 'new_horecas', label: 'New HoReCa Target', icon: <Users className="w-5 h-5" />, placeholder: 'e.g. 5' },
];

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

    const [formState, setFormState] = useState(() => {
        const state: Record<SalesTargetType, { value: string; startDate: string; endDate: string; enabled: boolean }> = {
            revenue: { value: '', startDate: defaultStart, endDate: defaultEnd, enabled: false },
            orders: { value: '', startDate: defaultStart, endDate: defaultEnd, enabled: false },
            new_horecas: { value: '', startDate: defaultStart, endDate: defaultEnd, enabled: false },
        };

        for (const type of ['revenue', 'orders', 'new_horecas'] as SalesTargetType[]) {
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

        for (const type of ['revenue', 'orders', 'new_horecas'] as SalesTargetType[]) {
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-stone-200">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                            <Target className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-stone-900">Set Sales Targets</h2>
                            <p className="text-sm text-stone-500">Define your goals with custom date ranges</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
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
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${field.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-200 text-stone-400'}`}>
                                        {icon}
                                    </div>
                                    <span className={`font-semibold ${field.enabled ? 'text-stone-900' : 'text-stone-400'}`}>{label}</span>
                                </label>

                                {field.enabled && (
                                    <div className="space-y-3 ml-7">
                                        <div>
                                            <label className="block text-xs font-medium text-stone-500 mb-1">Target Value</label>
                                            <div className="relative">
                                                {prefix && (
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 font-medium">{prefix}</span>
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

                {/* Footer */}
                <div className="flex justify-end gap-3 p-6 border-t border-stone-200">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 font-medium cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium cursor-pointer"
                    >
                        Save Targets
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SalesTargetModal;

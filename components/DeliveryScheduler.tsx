import React from 'react';
import type { DeliveryTimeSlot } from '../types';
import { DELIVERY_TIME_SLOTS, DELIVERY_LEAD_DAYS } from '../constants';
import { Calendar } from 'lucide-react';

interface DeliverySchedulerProps {
    deliveryDate: string;
    deliveryTimeSlot: DeliveryTimeSlot | '';
    onDateChange: (date: string) => void;
    onTimeSlotChange: (slot: DeliveryTimeSlot) => void;
}

const getNextBusinessDay = (fromDate: Date, leadDays: number): string => {
    const date = new Date(fromDate);
    let added = 0;
    while (added < leadDays) {
        date.setDate(date.getDate() + 1);
        const day = date.getDay();
        if (day !== 0 && day !== 6) added++;
    }
    return date.toISOString().split('T')[0];
};

const DeliveryScheduler: React.FC<DeliverySchedulerProps> = ({
    deliveryDate,
    deliveryTimeSlot,
    onDateChange,
    onTimeSlotChange,
}) => {
    const minDate = getNextBusinessDay(new Date(), DELIVERY_LEAD_DAYS);

    return (
        <div className="border-t border-stone-100 pt-5 mt-5">
            <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-stone-500" />
                <h4 className="text-sm font-medium text-stone-700">Delivery Schedule</h4>
                <span className="text-xs text-stone-500">(optional)</span>
            </div>

            <div className="space-y-3">
                <div>
                    <label htmlFor="delivery-date" className="block text-xs text-stone-500 mb-1">Delivery Date</label>
                    <input
                        type="date"
                        id="delivery-date"
                        value={deliveryDate}
                        min={minDate}
                        onChange={e => onDateChange(e.target.value)}
                        className="block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300"
                    />
                </div>

                {deliveryDate && (
                    <div>
                        <label className="block text-xs text-stone-500 mb-1.5">Time Slot</label>
                        <div className="grid grid-cols-1 gap-2">
                            {DELIVERY_TIME_SLOTS.map(slot => (
                                <button
                                    key={slot}
                                    type="button"
                                    onClick={() => onTimeSlotChange(slot)}
                                    className={`text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                                        deliveryTimeSlot === slot
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-stone-50 text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-100'
                                    }`}
                                >
                                    {slot}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DeliveryScheduler;

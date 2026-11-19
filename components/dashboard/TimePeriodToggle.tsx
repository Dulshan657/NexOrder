import React from 'react';
import type { DashboardTimePeriod } from '../../types';
import SegmentedToggle from './SegmentedToggle';

interface TimePeriodToggleProps {
  value: DashboardTimePeriod;
  onChange: (period: DashboardTimePeriod) => void;
}

const periods: { value: DashboardTimePeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'custom', label: 'Custom' },
];

/** The page period. Same control as every card's own window (SegmentedToggle). */
const TimePeriodToggle: React.FC<TimePeriodToggleProps> = ({ value, onChange }) => (
  <SegmentedToggle label="Period" options={periods} value={value} onChange={onChange} />
);

export default TimePeriodToggle;

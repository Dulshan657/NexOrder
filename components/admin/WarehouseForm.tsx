import React, { useMemo, useState } from 'react';
import { MapPin, Warehouse as WarehouseIcon } from 'lucide-react';
import WarehouseMapPicker from './WarehouseMapPicker';
import { Button, Field, Input, Modal, NumberInput, Textarea } from '../ui';
import { useCreateWarehouse, useUpdateWarehouse } from '../../hooks/queries/useWarehouses';
import type { Warehouse, WarehouseType } from '../../types';

interface WarehouseFormProps {
  warehouse: Warehouse | null; // null = create
  onClose: () => void;
}

interface FormState {
  code: string;
  name: string;
  locationType: WarehouseType;
  lat?: number;
  lng?: number;
  address: string;
  contact: string;
  hours: string;
  notes: string;
}

const toFormState = (warehouse: Warehouse | null): FormState => ({
  code: warehouse?.code ?? '',
  name: warehouse?.name ?? '',
  locationType: warehouse?.locationType ?? 'bulk',
  lat: warehouse?.lat,
  lng: warehouse?.lng,
  address: warehouse?.address ?? '',
  contact: warehouse?.contact ?? '',
  hours: warehouse?.hours ?? '',
  notes: warehouse?.notes ?? '',
});

const trimmedOrUndefined = (value: string): string | undefined => value.trim() || undefined;

const WarehouseForm: React.FC<WarehouseFormProps> = ({ warehouse, onClose }) => {
  const isEdit = warehouse !== null;
  const create = useCreateWarehouse();
  const update = useUpdateWarehouse();

  const [initial] = useState(() => toFormState(warehouse));
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);

  const saving = create.isPending || update.isPending;
  const isDirty = useMemo(
    () => (Object.keys(initial) as (keyof FormState)[]).some((key) => form[key] !== initial[key]),
    [form, initial],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || (!isEdit && !form.code.trim())) {
      setError('Code and name are required.');
      return;
    }
    const fields = {
      name: form.name.trim(),
      location_type: form.locationType,
      lat: form.lat,
      lng: form.lng,
      address: trimmedOrUndefined(form.address),
      contact: trimmedOrUndefined(form.contact),
      hours: trimmedOrUndefined(form.hours),
      notes: trimmedOrUndefined(form.notes),
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: warehouse!.id, updates: fields });
      } else {
        await create.mutateAsync({ code: form.code.trim(), ...fields });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save warehouse.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dirty={isDirty}
      onSubmit={handleSubmit}
      icon={<WarehouseIcon className="w-4 h-4 text-nexgen-blue" />}
      title={isEdit ? `Edit ${warehouse!.name}` : 'New Warehouse'}
      footer={({ requestClose }) => (
        <>
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {isEdit ? 'Save changes' : 'Create warehouse'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" htmlFor="wh-code">
            <Input
              id="wh-code"
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              disabled={isEdit}
              placeholder="SYD"
              maxLength={32}
            />
          </Field>
          <Field label="Name" htmlFor="wh-name">
            <Input
              id="wh-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Sydney DC"
            />
          </Field>
        </div>

        <Field
          label="Storage type"
          helper={
            form.locationType === 'bulk'
              ? 'Stock held in unorganised piles, depleted FIFO.'
              : 'Stock tracked in named bins, slotted by the optimiser.'
          }
        >
          <div className="grid grid-cols-2 gap-2">
            {(['bulk', 'racked'] as WarehouseType[]).map((type) => (
              <button
                type="button"
                key={type}
                aria-pressed={form.locationType === type}
                onClick={() => set('locationType', type)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors btn-press ${
                  form.locationType === type
                    ? 'bg-nexgen-blue text-white border-nexgen-blue'
                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                }`}
              >
                {type === 'bulk' ? 'Bulk (piles, FIFO)' : 'Racked (bins/WMS)'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Location">
          <p className="flex items-center gap-1 text-xs text-stone-400 mb-2">
            <MapPin className="w-3.5 h-3.5" /> Click the map to set coordinates
          </p>
          <WarehouseMapPicker
            lat={form.lat}
            lng={form.lng}
            onChange={(lat, lng) => setForm((current) => ({ ...current, lat, lng }))}
          />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <NumberInput
              step="0.000001"
              aria-label="Latitude"
              value={form.lat ?? ''}
              onChange={(e) => set('lat', e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder="Latitude"
            />
            <NumberInput
              step="0.000001"
              aria-label="Longitude"
              value={form.lng ?? ''}
              onChange={(e) => set('lng', e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder="Longitude"
            />
          </div>
        </Field>

        <Field label="Address" htmlFor="wh-address">
          <Input id="wh-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact" htmlFor="wh-contact">
            <Input id="wh-contact" value={form.contact} onChange={(e) => set('contact', e.target.value)} />
          </Field>
          <Field label="Hours" htmlFor="wh-hours">
            <Input
              id="wh-hours"
              value={form.hours}
              onChange={(e) => set('hours', e.target.value)}
              placeholder="Mon–Fri 7–4"
            />
          </Field>
        </div>

        <Field label="Notes" htmlFor="wh-notes">
          <Textarea id="wh-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default WarehouseForm;

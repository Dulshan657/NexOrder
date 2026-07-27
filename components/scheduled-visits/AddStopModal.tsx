import React, { useMemo, useState } from 'react';
import type { ScheduledVisit, HoReCa, User } from '../../types';
import { addStopToScheduledVisit } from '../../services/scheduledVisitService';
import { useCreateHoReCa } from '../../hooks/queries/useHoReCas';
import { Button, Modal } from '../ui';
import { Search, MapPin, Crosshair, Plus, Loader2 } from 'lucide-react';

interface AddStopModalProps {
  route: ScheduledVisit;
  hoReCas: HoReCa[];
  currentUser: User;
  onSaved: (updatedRoute: ScheduledVisit) => void;
  onClose: () => void;
}

type Tab = 'existing' | 'walkin';

const AddStopModal: React.FC<AddStopModalProps> = ({ route, hoReCas, currentUser, onSaved, onClose }) => {
  const [tab, setTab] = useState<Tab>('existing');
  const [search, setSearch] = useState('');
  const [selectedHoReCaId, setSelectedHoReCaId] = useState<number | null>(null);

  // Walk-in form state
  const [walkInName, setWalkInName] = useState('');
  const [walkInAddress, setWalkInAddress] = useState('');
  const [walkInLat, setWalkInLat] = useState<number | null>(null);
  const [walkInLng, setWalkInLng] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'capturing' | 'captured' | 'error'>('idle');
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Position picker — value is the index AT WHICH to insert (0..stops.length).
  // Default: append at end.
  const [insertAt, setInsertAt] = useState<number>(route.stops.length);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createHoReCaMutation = useCreateHoReCa();

  const existingStopIds = useMemo(() => new Set(route.stops.map(s => s.hoReCaId)), [route.stops]);
  const stopCustomers = useMemo(() => {
    const byId = new Map(hoReCas.map(h => [h.id, h] as const));
    return route.stops.map(s => byId.get(s.hoReCaId));
  }, [route.stops, hoReCas]);

  const filteredHoReCas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = hoReCas.filter(h => !existingStopIds.has(h.id) && !h.isTemporary);
    if (!q) return base.slice(0, 50);
    return base
      .filter(h => h.name.toLowerCase().includes(q) || h.address.toLowerCase().includes(q))
      .slice(0, 50);
  }, [hoReCas, existingStopIds, search]);

  const handleCaptureGps = () => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setGpsError('Geolocation is not supported by this browser.');
      return;
    }
    setGpsStatus('capturing');
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setWalkInLat(pos.coords.latitude);
        setWalkInLng(pos.coords.longitude);
        setGpsStatus('captured');
      },
      err => {
        setGpsStatus('error');
        setGpsError(err.message || 'Could not capture location.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const canSubmit = (() => {
    if (submitting) return false;
    if (tab === 'existing') return selectedHoReCaId !== null;
    return walkInName.trim().length > 0 && walkInAddress.trim().length > 0;
  })();

  // Derived over the existing scalars rather than a consolidated form object: only the
  // fields that represent real work count, so the transient search box, the active tab
  // and the GPS/submit status flags are deliberately excluded.
  const isDirty =
    selectedHoReCaId !== null ||
    walkInName.trim().length > 0 ||
    walkInAddress.trim().length > 0 ||
    walkInLat !== null ||
    walkInLng !== null ||
    insertAt !== route.stops.length;

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      let hoReCaId: number;
      if (tab === 'existing') {
        if (selectedHoReCaId === null) return;
        hoReCaId = selectedHoReCaId;
      } else {
        // Create a temporary HoReCa flagged for office follow-up.
        const { numericIdToUuid } = await import('../../lib/userIdMap');
        const created = await createHoReCaMutation.mutateAsync({
          horeca: {
            name: walkInName.trim(),
            address: walkInAddress.trim(),
            lat: walkInLat ?? null,
            lng: walkInLng ?? null,
            is_temporary: true,
            created_by_user_id: numericIdToUuid(currentUser.id),
          },
        });
        if (!created) throw new Error('Failed to create walk-in customer.');
        hoReCaId = created.id;
      }

      const updated = addStopToScheduledVisit(route, hoReCaId, insertAt);
      onSaved(updated);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to add stop.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      dirty={isDirty}
      icon={<Plus className="w-4 h-4 text-nexgen-blue" />}
      title="Add stop"
      footer={({ requestClose }) => (
        <>
          <Button variant="ghost" onClick={requestClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            Add stop
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {/* Tabs. DialogChrome has no slot between the header and the body, so the strip
            is bled back out to the panel edges rather than sitting inside the padding. */}
        <div className="flex border-b border-stone-200 px-2 -mx-6 -mt-5">
          <button
            onClick={() => setTab('existing')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'existing' ? 'border-nexgen-blue text-nexgen-blue' : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            Existing customer
          </button>
          <button
            onClick={() => setTab('walkin')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'walkin' ? 'border-nexgen-blue text-nexgen-blue' : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            Walk-in
          </button>
        </div>

        {tab === 'existing' ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or address"
                className="w-full pl-9 pr-4 py-2.5 bg-stone-50 rounded-lg ring-1 ring-inset ring-stone-200 text-sm focus:ring-2 focus:ring-nexgen-blue placeholder:text-stone-400"
                autoFocus
              />
            </div>
            <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-64 overflow-y-auto">
              {filteredHoReCas.length === 0 ? (
                <p className="p-4 text-sm text-stone-500 text-center">No matches.</p>
              ) : (
                filteredHoReCas.map(h => (
                  <button
                    key={h.id}
                    onClick={() => setSelectedHoReCaId(h.id)}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-stone-50 transition-colors flex items-start justify-between gap-3 ${
                      selectedHoReCaId === h.id ? 'bg-nexgen-blue/5' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900 truncate">{h.name}</p>
                      <p className="text-xs text-stone-500 truncate">{h.address}</p>
                    </div>
                    {selectedHoReCaId === h.id && (
                      <span className="text-xs font-medium text-nexgen-blue shrink-0">Selected</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Name</label>
              <input
                type="text"
                value={walkInName}
                onChange={e => setWalkInName(e.target.value)}
                placeholder="e.g. Thai Orchid Cafe"
                className="w-full px-3 py-2.5 bg-stone-50 rounded-lg ring-1 ring-inset ring-stone-200 text-sm focus:ring-2 focus:ring-nexgen-blue placeholder:text-stone-400"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Address</label>
              <input
                type="text"
                value={walkInAddress}
                onChange={e => setWalkInAddress(e.target.value)}
                placeholder="Street, suburb, city"
                className="w-full px-3 py-2.5 bg-stone-50 rounded-lg ring-1 ring-inset ring-stone-200 text-sm focus:ring-2 focus:ring-nexgen-blue placeholder:text-stone-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">Location</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCaptureGps}
                  disabled={gpsStatus === 'capturing'}
                  className="flex items-center gap-2 text-sm font-medium text-stone-700 bg-stone-50 px-3 py-2 rounded-lg ring-1 ring-inset ring-stone-200 hover:bg-stone-100 disabled:opacity-60"
                >
                  {gpsStatus === 'capturing' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Crosshair className="w-4 h-4" />
                  )}
                  {gpsStatus === 'captured' ? 'Re-capture GPS' : 'Capture GPS'}
                </button>
                {gpsStatus === 'captured' && walkInLat != null && walkInLng != null && (
                  <span className="text-xs text-emerald-700 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {walkInLat.toFixed(5)}, {walkInLng.toFixed(5)}
                  </span>
                )}
              </div>
              {gpsStatus === 'error' && (
                <p className="mt-1 text-xs text-red-600">{gpsError}</p>
              )}
              <p className="mt-1 text-xs text-stone-500">
                Optional but recommended — lets the stop appear on the route map.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              This creates a temporary customer record that admins will review and promote to the CRM.
            </div>
          </>
        )}

        {/* Position picker */}
        <div className="pt-2 border-t border-stone-100">
          <label className="block text-xs font-medium text-stone-600 mb-1">Insert at</label>
          <select
            value={insertAt}
            onChange={e => setInsertAt(Number(e.target.value))}
            className="w-full px-3 py-2.5 bg-stone-50 rounded-lg ring-1 ring-inset ring-stone-200 text-sm focus:ring-2 focus:ring-nexgen-blue"
          >
            {route.stops.map((stop, idx) => {
              const c = stopCustomers[idx];
              const label = c ? c.name : `Stop ${idx + 1}`;
              return (
                <option key={`before-${stop.hoReCaId}`} value={idx}>
                  Before stop {idx + 1} — {label}
                </option>
              );
            })}
            <option value={route.stops.length}>
              At the end {route.stops.length > 0 ? `(after stop ${route.stops.length})` : ''}
            </option>
          </select>
        </div>

        {submitError && (
          <p className="text-sm text-red-600">{submitError}</p>
        )}
      </div>
    </Modal>
  );
};

export default AddStopModal;

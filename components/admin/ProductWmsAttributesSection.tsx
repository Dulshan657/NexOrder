// Per-product WMS attributes editor, embedded in ProductForm (mirrors the
// ProductHomeBinsSection pattern). Feeds the WIE engine's rule evaluation
// (hazard/temp/handling) — all fields optional; a product with none behaves as
// before.

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getWmsAttributes, saveWmsAttributes, type WmsAttributesInput } from '@/services/supabase/wmsAttributesService'
import { useToasts } from '@/hooks/useToasts'
import type { LevelRole, ProductWmsAttributes, ShelfLifePolicy } from '@/types'

interface ProductWmsAttributesSectionProps {
  productId: number
}

const LEVEL_ROLES: LevelRole[] = ['pick', 'reserve', 'bulk']

// `allowed_level_roles` (mig 00072) isn't on ProductWmsAttributes / the
// wmsAttributesService payload yet — read/write it defensively through these
// extensions so this section works today and picks the field up for free once
// the type/service/adapter land it (another agent's edge-function change).
type WmsAttributesWithLevelRoles = ProductWmsAttributes & { allowedLevelRoles?: LevelRole[] | null }
type WmsAttributesInputWithLevelRoles = WmsAttributesInput & { allowed_level_roles?: LevelRole[] | null }

export default function ProductWmsAttributesSection({ productId }: ProductWmsAttributesSectionProps) {
  const qc = useQueryClient()
  const { addToast } = useToasts()
  const { data } = useQuery({ queryKey: ['wms-attributes', productId], queryFn: () => getWmsAttributes(productId) })
  const save = useMutation({
    mutationFn: saveWmsAttributes,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wms-attributes', productId] })
      addToast('Warehouse attributes saved', 'success')
    },
    onError: (e) => addToast(e instanceof Error ? e.message : 'Failed to save attributes', 'error'),
  })

  const [hazard, setHazard] = useState('')
  const [tempMin, setTempMin] = useState('')
  const [tempMax, setTempMax] = useState('')
  const [policy, setPolicy] = useState<ShelfLifePolicy | ''>('')
  const [handling, setHandling] = useState('')
  const [stackable, setStackable] = useState<boolean | null>(null)
  const [allowedLevelRoles, setAllowedLevelRoles] = useState<LevelRole[]>([])

  useEffect(() => {
    if (data) {
      setHazard(data.hazardClass ?? '')
      setTempMin(data.tempMin != null ? String(data.tempMin) : '')
      setTempMax(data.tempMax != null ? String(data.tempMax) : '')
      setPolicy(data.shelfLifePolicy ?? '')
      setHandling(data.handlingType ?? '')
      setStackable(data.stackable ?? null)
      setAllowedLevelRoles((data as WmsAttributesWithLevelRoles).allowedLevelRoles ?? [])
    }
  }, [data])

  const toggleLevelRole = (role: LevelRole) => {
    setAllowedLevelRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    )
  }

  const onSave = () => {
    const payload: WmsAttributesInputWithLevelRoles = {
      product_id: productId,
      hazard_class: hazard.trim() || null,
      temp_min: tempMin === '' ? null : Number(tempMin),
      temp_max: tempMax === '' ? null : Number(tempMax),
      shelf_life_policy: policy || null,
      handling_type: handling.trim() || null,
      stackable,
      allowed_level_roles: allowedLevelRoles.length > 0 ? allowedLevelRoles : null,
    }
    save.mutate(payload)
  }

  return (
    <div className="mt-4 pt-4 border-t border-stone-200">
      <h4 className="text-xs font-semibold text-stone-600 mb-2">Warehouse attributes</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="block text-stone-500">
          Hazard class
          <input className="mt-1 w-full border border-stone-200 rounded px-2 py-1" value={hazard} onChange={(e) => setHazard(e.target.value)} placeholder="none" />
        </label>
        <label className="block text-stone-500">
          Handling
          <input className="mt-1 w-full border border-stone-200 rounded px-2 py-1" value={handling} onChange={(e) => setHandling(e.target.value)} placeholder="pallet / carton / loose" />
        </label>
        <label className="block text-stone-500">
          Temp min (°C)
          <input type="number" className="mt-1 w-full border border-stone-200 rounded px-2 py-1" value={tempMin} onChange={(e) => setTempMin(e.target.value)} />
        </label>
        <label className="block text-stone-500">
          Temp max (°C)
          <input type="number" className="mt-1 w-full border border-stone-200 rounded px-2 py-1" value={tempMax} onChange={(e) => setTempMax(e.target.value)} />
        </label>
        <label className="block text-stone-500">
          Shelf life
          <select className="mt-1 w-full border border-stone-200 rounded px-2 py-1" value={policy} onChange={(e) => setPolicy(e.target.value as ShelfLifePolicy | '')}>
            <option value="">—</option>
            <option value="FEFO">FEFO</option>
            <option value="FIFO">FIFO</option>
          </select>
        </label>
        <label className="block text-stone-500">
          Stackable
          <select className="mt-1 w-full border border-stone-200 rounded px-2 py-1" value={stackable === null ? '' : String(stackable)} onChange={(e) => setStackable(e.target.value === '' ? null : e.target.value === 'true')}>
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>

      {/* Allowed level roles (mig 00072) — the HARD putaway gate: this SKU may
          only be placed on a rack level whose role is checked here. */}
      <fieldset className="mt-3 border border-stone-200 rounded-lg p-2.5">
        <legend className="text-xs font-medium text-stone-600 px-1">Allowed level roles</legend>
        <div className="flex items-center gap-4">
          {LEVEL_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-1.5 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={allowedLevelRoles.includes(role)}
                onChange={() => toggleLevelRole(role)}
              />
              {role}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-stone-400 mt-1.5">
          {allowedLevelRoles.length === 0
            ? 'Nothing checked = any level role is allowed. This is how every product behaves today.'
            : `Restricted to ${allowedLevelRoles.join(', ')} levels — putaway will never place this SKU on any other role without an operator override.`}
        </p>
      </fieldset>

      <button className="mt-2 text-xs px-3 py-1.5 border border-stone-200 rounded-lg btn-press disabled:opacity-40" onClick={onSave} disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save attributes'}
      </button>
    </div>
  )
}

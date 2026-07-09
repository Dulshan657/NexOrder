// Settings → General: company contact details (drafted) + logo upload
// (saves immediately on upload/remove, matching the previous behaviour).

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Image as ImageIcon, Loader2 } from 'lucide-react'
import type { AppSettings } from '../../../types'
import type { Database } from '../../../lib/database.types'
import { uploadToBucket, deleteFromBucketByUrl } from '../../../services/supabase/storageService'
import { toAppSettings, fromAppSettings } from '../../../lib/adapters'
import { useSettings, useUpdateSettings } from '../../../hooks/queries/useSettings'
import { useToasts } from '../../../hooks/useToasts'
import { useSettingsDraft } from './useSettingsDraft'
import { SettingsSection, SettingsField, TextInput, SaveBar } from './primitives'

type SettingsUpdate = Database['public']['Tables']['app_settings']['Update']

const KEYS = ['companyName', 'companyAddress', 'companyPhone', 'companyEmail'] as const
type Key = (typeof KEYS)[number]

const GeneralTab: React.FC = () => {
  const { loaded, draft, setField, isDirty, errors, isSaving, save, discard } =
    useSettingsDraft<Key>(KEYS)

  if (!loaded || !draft) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    )
  }

  return (
    <div className="max-w-3xl divide-y divide-stone-200">
      <SettingsSection
        title="Company information"
        description="Shown on documents and order confirmations."
        icon={<Building2 className="w-5 h-5" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SettingsField label="Company Name" htmlFor="settings-company-name">
            <TextInput
              id="settings-company-name"
              value={draft.companyName}
              onChange={e => setField('companyName', e.target.value)}
            />
          </SettingsField>
          <SettingsField
            label="Email"
            htmlFor="settings-company-email"
            error={errors.companyEmail}
          >
            <TextInput
              id="settings-company-email"
              type="email"
              value={draft.companyEmail}
              onChange={e => setField('companyEmail', e.target.value)}
              placeholder="orders@company.com"
              invalid={!!errors.companyEmail}
            />
          </SettingsField>
          <SettingsField label="Phone" htmlFor="settings-company-phone">
            <TextInput
              id="settings-company-phone"
              value={draft.companyPhone}
              onChange={e => setField('companyPhone', e.target.value)}
              placeholder="+61 2 1234 5678"
            />
          </SettingsField>
          <SettingsField label="Address" htmlFor="settings-company-address">
            <TextInput
              id="settings-company-address"
              value={draft.companyAddress}
              onChange={e => setField('companyAddress', e.target.value)}
              placeholder="123 Business St, Sydney NSW"
            />
          </SettingsField>
        </div>
        <SaveBar
          isDirty={isDirty}
          isSaving={isSaving}
          hasErrors={Object.keys(errors).length > 0}
          onSave={save}
          onDiscard={discard}
        />
      </SettingsSection>

      <LogoSection />
    </div>
  )
}

/** Logo upload/remove — persists immediately (not part of the draft),
 *  ported from the pre-revamp settings panel. */
const LogoSection: React.FC = () => {
  const settingsQuery = useSettings()
  const updateMutation = useUpdateSettings()
  const { addToast } = useToasts()

  const serverLogo = useMemo<string | null>(() => {
    if (!settingsQuery.data) return null
    return toAppSettings(settingsQuery.data).companyLogoUrl ?? null
  }, [settingsQuery.data])

  const [logoPreview, setLogoPreview] = useState<string | null>(serverLogo)
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLogoPreview(serverLogo)
  }, [serverLogo])

  const persistLogo = (logo: string | null) => {
    const patch: Partial<AppSettings> = { companyLogoUrl: logo }
    updateMutation.mutate(fromAppSettings(patch) as SettingsUpdate, {
      onError: err =>
        addToast(`Error saving logo: ${err instanceof Error ? err.message : 'unknown error'}`, 'error'),
    })
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    setIsUploadingLogo(true)
    try {
      const url = await uploadToBucket('company-assets', file, { prefix: 'logos' })
      setLogoPreview(url)
      persistLogo(url)
      addToast('Logo uploaded.', 'success')
    } catch (err) {
      addToast(err instanceof Error ? `Logo upload failed: ${err.message}` : 'Logo upload failed', 'error')
    } finally {
      setIsUploadingLogo(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemoveLogo = async () => {
    const previousUrl = logoPreview
    setLogoPreview(null)
    persistLogo(null)
    if (previousUrl) {
      // Fire-and-forget bucket cleanup, matching previous behaviour.
      try {
        await deleteFromBucketByUrl('company-assets', previousUrl)
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <SettingsSection
      title="Company logo"
      description="Displayed in the sidebar. Recommended: 200x50px. Changes save immediately."
      icon={<ImageIcon className="w-5 h-5" />}
    >
      <div className="flex items-center gap-4">
        <div className="w-40 h-20 bg-white border border-stone-200 rounded-lg flex items-center justify-center p-2 shadow-sm">
          {isUploadingLogo ? (
            <Loader2 className="w-6 h-6 text-stone-400 animate-spin" />
          ) : logoPreview ? (
            <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-stone-400 text-xs">No Logo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            disabled={isUploadingLogo}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingLogo}
            className="bg-white py-2 px-3 border border-stone-300 rounded-lg text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors btn-press cursor-pointer focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isUploadingLogo ? 'Uploading…' : 'Upload Logo'}
          </button>
          {logoPreview && !isUploadingLogo && (
            <button
              type="button"
              onClick={() => void handleRemoveLogo()}
              className="text-xs font-medium text-red-600 hover:text-red-800 self-start transition-colors cursor-pointer rounded px-1 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}

export default GeneralTab

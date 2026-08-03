// Settings → Warehouse: hosts the five existing warehouse-intelligence
// sections untouched. They own their modals, hooks, and the `?designer=`
// deep-link logic — only their mount point moved here.
//
// Each section is wrapped in an id'd <section> so a `?section=` deep link (from
// the warehouse setup checklist) can scroll to it. The ids live in
// lib/warehouseSetup/steps.ts, which is what the checklist links against, and
// lib/subtabUrl.ts maps each one back to this sub-tab.

import React from 'react'
import WarehousesSettingsSection from '../WarehousesSettingsSection'
import StorageFormsView from './StorageFormsView'
import LevelRolesSection from '../LevelRolesSection'
import ZoneProfilesSection from '../ZoneProfilesSection'
import LabelPrintingSection from '../LabelPrintingSection'
import { SETTINGS_SECTION_IDS } from '../../../lib/warehouseSetup/steps'
import { useSectionDeepLink } from './useSectionDeepLink'

const SECTION_IDS = Object.values(SETTINGS_SECTION_IDS)

// Level roles sit directly after Storage Forms: a form's level template picks
// roles from this vocabulary, so reading them in that order matches the order an
// operator sets them up in.
const WarehouseTab: React.FC = () => {
  useSectionDeepLink(SECTION_IDS)

  return (
    <div className="space-y-6">
      <section id={SETTINGS_SECTION_IDS.warehouses}>
        <WarehousesSettingsSection />
      </section>
      <section id={SETTINGS_SECTION_IDS.storageForms}>
        <StorageFormsView />
      </section>
      <section id={SETTINGS_SECTION_IDS.levelRoles}>
        <LevelRolesSection />
      </section>
      <section id={SETTINGS_SECTION_IDS.zoneProfiles}>
        <ZoneProfilesSection />
      </section>
      <section id={SETTINGS_SECTION_IDS.labelPrinting}>
        <LabelPrintingSection />
      </section>
    </div>
  )
}

export default WarehouseTab

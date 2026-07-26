// Settings → Warehouse: hosts the three existing warehouse-intelligence
// sections untouched. They own their modals, hooks, and the `?designer=`
// deep-link logic — only their mount point moved here.

import React from 'react'
import WarehousesSettingsSection from '../WarehousesSettingsSection'
import StorageFormsView from './StorageFormsView'
import LevelRolesSection from '../LevelRolesSection'
import ZoneProfilesSection from '../ZoneProfilesSection'
import LabelPrintingSection from '../LabelPrintingSection'

// Level roles sit directly after Storage Forms: a form's level template picks
// roles from this vocabulary, so reading them in that order matches the order an
// operator sets them up in.
const WarehouseTab: React.FC = () => (
  <div className="space-y-6">
    <WarehousesSettingsSection />
    <StorageFormsView />
    <LevelRolesSection />
    <ZoneProfilesSection />
    <LabelPrintingSection />
  </div>
)

export default WarehouseTab

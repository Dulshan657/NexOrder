// Settings → Warehouse: hosts the three existing warehouse-intelligence
// sections untouched. They own their modals, hooks, and the `?designer=`
// deep-link logic — only their mount point moved here.

import React from 'react'
import WarehousesSettingsSection from '../WarehousesSettingsSection'
import StorageFormsView from './StorageFormsView'
import ZoneProfilesSection from '../ZoneProfilesSection'
import LabelPrintingSection from '../LabelPrintingSection'

const WarehouseTab: React.FC = () => (
  <div className="space-y-6">
    <WarehousesSettingsSection />
    <StorageFormsView />
    <ZoneProfilesSection />
    <LabelPrintingSection />
  </div>
)

export default WarehouseTab

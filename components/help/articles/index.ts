// Article bodies by slug (NX-0038). Every manifest slug must have one;
// __tests__/help/manifest.test.ts holds the two lists together.

import type React from 'react'
import WarehouseJourney from './WarehouseJourney'
import ReceiveDelivery from './ReceiveDelivery'
import PutPalletAway from './PutPalletAway'
import CheckStockLocation from './CheckStockLocation'
import AssignPutaway from './AssignPutaway'
import SomethingWrong from './SomethingWrong'

export const ARTICLE_BODIES: Record<string, React.FC> = {
  'warehouse-journey': WarehouseJourney,
  'receive-a-delivery': ReceiveDelivery,
  'put-a-pallet-away': PutPalletAway,
  'check-stock-location': CheckStockLocation,
  'assign-putaway': AssignPutaway,
  'if-something-goes-wrong': SomethingWrong,
}

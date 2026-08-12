// Demo user roster — seeding only. NEVER import this from application code.
//
// This lived in `constants.ts` until the Amadiya production cutover, which made
// it a problem: `constants.ts` is imported by `App.tsx`, so these six records —
// including `alice@nexorder.com.au`, a live Admin — were bundled into every
// browser that ever loaded the app. Turning `VITE_SHOW_DEMO_LOGINS` off hid the
// click-to-fill panel; it did nothing about the array sitting in the JavaScript.
//
// On a client's deployment none of these accounts exist, so shipping them is
// worse than untidy: it advertises credentials for a different system.
//
// It now sits beside the rest of the seed data, which `supabase/seed.ts` is the
// only consumer of and which never reaches a bundler. (PRODUCTION-LAUNCH-PLAN
// §A5 suggested `tests/fixtures/`; here is better, because
// `supabase/seedData/orders.ts` needs this roster to build its demo orders and
// a `supabase/ → tests/` import would be a strange direction for that
// dependency to run. The requirement was "not in the browser bundle", and this
// satisfies it.)
//
// Gate B asserts `alice@nexorder.com.au` does not appear in the built bundle.

import type { User } from '../../types';
import { UserRole } from '../../types';

export const USERS: User[] = [
  { id: 1, name: 'Alice Johnson', email: 'alice@nexorder.com.au', role: UserRole.ADMIN, avatarUrl: 'https://i.pravatar.cc/150?u=1' },
  { id: 2, name: 'Bob Williams', email: 'bob@nexorder.com.au', role: UserRole.MANAGER, avatarUrl: 'https://i.pravatar.cc/150?u=2' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@nexorder.com.au', role: UserRole.FIELD_REP, avatarUrl: 'https://i.pravatar.cc/150?u=3' },
  { id: 4, name: 'David Lee', email: 'david@seasidebistro.com', role: UserRole.CUSTOMER, avatarUrl: 'https://i.pravatar.cc/150?u=4', hoReCaId: 2 },
  { id: 5, name: 'Emma Chen', email: 'emma@nexorder.com.au', role: UserRole.OFFICE_REP, avatarUrl: 'https://i.pravatar.cc/150?u=5' },
  { id: 6, name: 'Mei Lin', email: 'mei@lotusgarden.com.au', role: UserRole.CUSTOMER, avatarUrl: 'https://i.pravatar.cc/150?u=6', hoReCaId: 4 },
];

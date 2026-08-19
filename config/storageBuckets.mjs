// What each Storage bucket's visibility must be, and who may write to it.
//
// WHY THIS FILE EXISTS. It is `config/lockedTables.mjs` for object storage, and
// for the same reason. Risk-register R-02 recorded "the buckets were made
// private and access issued through audited signed URLs" as CLOSED while no
// migration in the repository made that change — a claim about the database
// that lived only in prose, so the only way to check it was to read 114
// migrations and reason about the residue. Three audits read the prose.
// Security-audit findings STOR-1 and STOR-2 (2026-08-19), closed by mig 00113.
//
// `npm run check:storage:<target>` is the test.
//
// ── IT CHECKS POLICIES, NOT GRANTS, AND THAT IS THE DIFFERENCE FROM lockedTables
//
// On `public` tables the grant is the sharper instrument: an absent policy
// denies a write only until somebody adds one back. On `storage.objects` there
// is no such lever. Supabase grants that table broadly to anon and
// authenticated by platform default and relies entirely on RLS, and revoking
// there would be undone by the next storage upgrade. Two facts, both verified
// on dev rather than assumed, are what make policies sufficient:
//
//   * `storage.buckets` has RLS enabled with ZERO policies, so no client role
//     can read it, let alone flip `public` back on.
//   * the `storage` schema is not exposed through PostgREST — `Accept-Profile:
//     storage` with the anon key answers 406 where public.orders answers 401 —
//     so TRUNCATE, the one write RLS cannot constrain, has no browser route.
//
// So for storage the two levers are the bucket's `public` flag and the shape of
// its policies, and those are exactly what this file pins.
//
// ── ADDING A BUCKET HERE IS PART OF CREATING ONE ────────────────────────────
//
// A bucket absent from this map is reported as unknown rather than ignored.
// `signatures` sat public and world-writable for 109 migrations precisely
// because nothing enumerated what the right answer was supposed to be.

/** The roles a browser can ever authenticate as. */
export const CLIENT_ROLES = ['anon', 'authenticated']

/**
 * The role names a policy may grant to that a browser can reach.
 *
 * `public` is in this list and must stay in it. It is a SUPERSET of anon and
 * authenticated, not a separate audience, and it is exactly how the hole was
 * spelled: `public_read_signatures` was `FOR SELECT TO public` (00004:26), so a
 * check that looked only for anon/authenticated would have declared the bucket
 * clean while the CDN served every signature to the internet.
 */
export const CLIENT_FACING_ROLES = ['anon', 'authenticated', 'public']

/**
 * Every bucket, and what must be true of it.
 *
 * `public`         — the required `storage.buckets.public` value.
 * `clientWrite`    — null when no client-facing role may INSERT/UPDATE/DELETE
 *                    on it at all; otherwise a description of who may, for the
 *                    failure message.
 * `allowClientRead`— whether a client-facing SELECT policy is legitimate. False
 *                    means every read goes through a service-role signed URL,
 *                    so ANY client SELECT policy is a finding. Note this is a
 *                    separate axis from `clientWrite`: po-archive is private and
 *                    unwritable by a client, yet carries a role-gated SELECT
 *                    policy (00019:41) on purpose.
 * `fn`             — what writes it, named in the failure message.
 * `migration`      — where the rule was set.
 */
export const STORAGE_BUCKETS = [
  {
    id: 'company-assets',
    public: true,
    clientWrite: 'Admin',
    allowClientRead: true,
    fn: 'browser upload, gated to Admin by policy',
    migration: '00113',
  },
  {
    id: 'product-images',
    public: true,
    clientWrite: 'Admin, Manager',
    allowClientRead: true,
    fn: 'browser upload, gated to Admin/Manager by policy',
    migration: '00113',
  },
  {
    id: 'avatars',
    public: true,
    clientWrite: 'Admin',
    allowClientRead: true,
    fn: 'browser upload, gated to Admin by policy',
    migration: '00113',
  },
  {
    id: 'signatures',
    public: false,
    clientWrite: null,
    allowClientRead: false,
    fn: 'upload-signature / create-signature-url',
    migration: '00113',
  },
  {
    id: 'visit-photos',
    public: false,
    clientWrite: null,
    allowClientRead: false,
    fn: 'mutate-visit-photo / create-visit-photo-urls',
    migration: '00113',
  },
  {
    id: 'po-archive',
    public: false,
    clientWrite: null,
    allowClientRead: true,
    fn: 'poll-inbox / extract-po (read via create-po-document-url)',
    migration: '00019',
  },
  {
    id: 'order-documents',
    public: false,
    clientWrite: null,
    allowClientRead: true,
    fn: 'generate-pick-slip / generate-dispatch-advice (read via create-order-document-url)',
    migration: '00031',
  },
  {
    id: 'floorplan-scans',
    public: false,
    clientWrite: null,
    allowClientRead: false,
    fn: 'create-floorplan-upload-url / extract-floorplan',
    migration: '00058',
  },
  {
    id: 'warehouse-labels',
    public: false,
    clientWrite: null,
    allowClientRead: true,
    fn: 'generate-labels',
    migration: '00074',
  },
]

/**
 * Policy commands that may never be granted to a client-facing role on
 * storage.objects, on ANY bucket.
 *
 * `ALL` is the shape of STOR-1, not merely one instance of it: `FOR ALL`
 * silently includes SELECT — which on storage.objects is the LIST operation —
 * along with UPDATE and DELETE, so a policy written to permit an upload
 * permitted enumeration and destruction as well. Naming the verb is what makes
 * the author decide. This rule is what stops the bug being reintroduced under a
 * different bucket name.
 */
export const FORBIDDEN_POLICY_CMDS = ['ALL']

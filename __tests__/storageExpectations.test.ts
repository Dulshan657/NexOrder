import { describe, expect, it } from 'vitest'

import { findStorageViolations, expectedBucketIds } from '../scripts/lib/storageExpectations.mjs'
import { STORAGE_BUCKETS } from '../config/storageBuckets.mjs'

interface BucketRow { id: string; public: boolean }

/**
 * The pure half of `check:storage` (security-audit STOR-1 / STOR-2, mig 00113).
 *
 * The script itself can only run where a Supabase access token exists, so this
 * is the part CI can assert — the same split as grantExpectations.test.ts.
 *
 * The cases below are not hypothetical. Every one of them is the state dev and
 * production were actually in on 2026-08-19.
 */

/** The world as 00113 leaves it. */
function goodBuckets(): BucketRow[] {
  return STORAGE_BUCKETS.map((e: BucketRow) => ({ id: e.id, public: e.public }))
}

const GOOD_POLICIES = [
  { policyname: 'company_assets_select_public', cmd: 'SELECT', roles: ['public'], qual: "bucket_id = 'company-assets'::text" },
  { policyname: 'company_assets_insert_admin', cmd: 'INSERT', roles: ['authenticated'], qual: "bucket_id = 'company-assets'::text AND user_role() = 'Admin'" },
  { policyname: 'po_archive_select_admin_manager', cmd: 'SELECT', roles: ['authenticated'], qual: "bucket_id = 'po-archive'::text AND user_role() = ANY(ARRAY['Admin','Manager'])" },
]

describe('findStorageViolations', () => {
  it('is silent when every bucket matches and no policy exceeds its bucket', () => {
    expect(findStorageViolations(goodBuckets(), GOOD_POLICIES)).toEqual([])
  })

  it('catches a bucket that is still public — STOR-2 as it actually stood', () => {
    const buckets: BucketRow[] = goodBuckets().map((b) =>
      b.id === 'signatures' ? { id: 'signatures', public: true } : b,
    )
    const findings = findStorageViolations(buckets, GOOD_POLICIES)
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('public_bucket')
    expect(findings[0].subject).toBe('signatures')
    expect(findings[0].message).toContain('RLS not consulted')
  })

  it('catches FOR ALL to authenticated on ANY bucket — the shape of STOR-1', () => {
    const findings = findStorageViolations(goodBuckets(), [
      ...GOOD_POLICIES,
      { policyname: 'auth_write_signatures', cmd: 'ALL', roles: ['authenticated'], qual: "bucket_id = 'signatures'::text" },
    ])
    expect(findings.map((f: { kind: string }) => f.kind)).toContain('forbidden_cmd')
    expect(findings[0].message).toContain('LIST operation')
  })

  it('catches FOR ALL even on a bucket that is allowed client writes', () => {
    // The rule is about the verb, not the bucket. Naming ALL on `avatars` is
    // just as wrong: it grants delete over every other object in the table
    // subject only to the predicate.
    const findings = findStorageViolations(goodBuckets(), [
      { policyname: 'auth_write_avatars', cmd: 'ALL', roles: ['authenticated'], qual: "bucket_id = 'avatars'::text" },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('forbidden_cmd')
  })

  it('does not flag FOR ALL granted only to service_role', () => {
    const findings = findStorageViolations(goodBuckets(), [
      { policyname: 'svc_all', cmd: 'ALL', roles: ['service_role'], qual: "bucket_id = 'signatures'::text" },
    ])
    expect(findings).toEqual([])
  })

  it('catches any client policy at all on a service-role-only bucket', () => {
    const findings = findStorageViolations(goodBuckets(), [
      { policyname: 'signatures_select_staff', cmd: 'SELECT', roles: ['authenticated'], qual: "bucket_id = 'signatures'::text" },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('client_policy')
    expect(findings[0].message).toContain('create-signature-url')
  })

  it('catches FOR SELECT TO public on a private bucket — how public_read_signatures was spelled', () => {
    // `public` is a SUPERSET of anon and authenticated, not a narrower audience.
    // A check that looked only for anon/authenticated would have called
    // 00004:26 clean while the CDN served every signature to the internet.
    const findings = findStorageViolations(goodBuckets(), [
      { policyname: 'public_read_signatures', cmd: 'SELECT', roles: ['public'], qual: "bucket_id = 'signatures'::text" },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('client_policy')
  })

  it('leaves po-archive’s role-gated SELECT alone — private and readable are different axes', () => {
    // The bucket takes no client writes, but 00019:41 grants Admin/Manager
    // SELECT on purpose. Conflating the two axes would have made this a finding.
    const findings = findStorageViolations(goodBuckets(), [
      { policyname: 'po_archive_select_admin_manager', cmd: 'SELECT', roles: ['authenticated'], qual: "bucket_id = 'po-archive'::text" },
    ])
    expect(findings).toEqual([])
  })

  it('still catches a WRITE policy on po-archive', () => {
    const findings = findStorageViolations(goodBuckets(), [
      { policyname: 'po_archive_insert_anyone', cmd: 'INSERT', roles: ['authenticated'], qual: "bucket_id = 'po-archive'::text" },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('client_policy')
  })

  it('reports a declared bucket that is absent rather than passing it', () => {
    const buckets = goodBuckets().filter((b) => b.id !== 'visit-photos')
    const findings = findStorageViolations(buckets, GOOD_POLICIES)
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('missing_bucket')
    expect(findings[0].message).toContain('unverified')
  })

  it('reports a bucket nobody declared', () => {
    const findings = findStorageViolations(
      [...goodBuckets(), { id: 'scratch', public: true }],
      GOOD_POLICIES,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('unknown_bucket')
  })

  it('reports a public-by-design bucket that has been closed by mistake', () => {
    const buckets: BucketRow[] = goodBuckets().map((b) =>
      b.id === 'product-images' ? { id: 'product-images', public: false } : b,
    )
    const findings = findStorageViolations(buckets, GOOD_POLICIES)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('broken images')
  })
})

describe('config/storageBuckets.mjs', () => {
  it('declares every bucket exactly once', () => {
    const ids = expectedBucketIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the two buckets holding personal information private and closed', () => {
    for (const id of ['signatures', 'visit-photos']) {
      const entry = STORAGE_BUCKETS.find((e: { id: string }) => e.id === id)
      expect(entry, `${id} must be declared`).toBeTruthy()
      expect(entry.public, `${id} must be private`).toBe(false)
      expect(entry.clientWrite, `${id} must be service-role-only`).toBeNull()
      expect(entry.allowClientRead, `${id} must have no client read policy`).toBe(false)
    }
  })
})

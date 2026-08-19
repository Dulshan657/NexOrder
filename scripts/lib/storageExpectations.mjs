// Compare what a database's Storage configuration actually is against what
// config/storageBuckets.mjs says it should be.
//
// PURE. Takes rows, returns findings. No database, no filesystem, no argv — so
// the interesting half of `check:storage` is unit-testable without credentials,
// exactly as scripts/lib/grantExpectations.mjs is for `check:grants`.

import { CLIENT_FACING_ROLES, FORBIDDEN_POLICY_CMDS, STORAGE_BUCKETS } from '../../config/storageBuckets.mjs'

/**
 * @typedef {object} BucketRow
 * @property {string} id
 * @property {boolean} public
 */

/**
 * @typedef {object} PolicyRow
 * @property {string} policyname
 * @property {string} cmd            SELECT | INSERT | UPDATE | DELETE | ALL
 * @property {readonly string[]} roles
 * @property {string|null} qual
 * @property {string|null} [with_check]
 */

/**
 * @typedef {object} Finding
 * @property {'public_bucket'|'missing_bucket'|'unknown_bucket'|'forbidden_cmd'|'client_policy'} kind
 * @property {string} subject
 * @property {string} message
 */

/** Which bucket a policy predicate names, or null if it names none of ours. */
function bucketOf(policy) {
  const text = `${policy.qual ?? ''} ${policy.with_check ?? ''}`
  for (const entry of STORAGE_BUCKETS) {
    // Matches `bucket_id = 'signatures'::text` and the unquoted form alike.
    if (text.includes(`'${entry.id}'`)) return entry.id
  }
  return null
}

function namesClientRole(policy) {
  return (policy.roles ?? []).some((r) => CLIENT_FACING_ROLES.includes(r))
}

const WRITE_CMDS = ['INSERT', 'UPDATE', 'DELETE']

/**
 * @param {readonly BucketRow[]} buckets rows from storage.buckets
 * @param {readonly PolicyRow[]} policies rows from pg_policies on storage.objects
 * @returns {Finding[]}
 */
export function findStorageViolations(buckets, policies) {
  const findings = []
  const byId = new Map(buckets.map((b) => [b.id, b]))

  for (const entry of STORAGE_BUCKETS) {
    const actual = byId.get(entry.id)

    // A bucket that is absent is a finding, not a pass. The two ways this check
    // can lull someone are a wrong flag it fails to see and a bucket renamed out
    // from under the expectation so nothing is ever compared.
    if (!actual) {
      findings.push({
        kind: 'missing_bucket',
        subject: entry.id,
        message:
          `Bucket "${entry.id}" is listed in config/storageBuckets.mjs but does not exist ` +
          'on this target. Either it was renamed and the expectation was not, or this ' +
          `database is behind mig ${entry.migration} — both mean its visibility is unverified.`,
      })
      continue
    }

    if (actual.public !== entry.public) {
      findings.push({
        kind: 'public_bucket',
        subject: entry.id,
        message:
          `Bucket "${entry.id}" is public=${actual.public}, expected ${entry.public}. ` +
          (entry.public === false
            ? 'A public bucket is served by the CDN with no JWT and with storage.objects RLS ' +
              'not consulted at all, so every policy on it is decorative for that path. ' +
              `Written by ${entry.fn} (mig ${entry.migration}).`
            : `This bucket is public by design and something has closed it; ${entry.fn} ` +
              'will be serving broken images.'),
      })
    }
  }

  for (const policy of policies) {
    const bucket = bucketOf(policy)

    if (FORBIDDEN_POLICY_CMDS.includes(policy.cmd) && namesClientRole(policy)) {
      findings.push({
        kind: 'forbidden_cmd',
        subject: policy.policyname,
        message:
          `Policy "${policy.policyname}" on storage.objects is FOR ${policy.cmd} to ` +
          `${(policy.roles ?? []).join(', ')}. That is the exact shape of security-audit ` +
          'finding STOR-1: FOR ALL silently includes SELECT — the LIST operation — plus ' +
          'UPDATE and DELETE, so a policy meant to permit an upload permits enumeration ' +
          'and destruction too. Name the verb.',
      })
      continue
    }

    if (!bucket) continue
    const entry = STORAGE_BUCKETS.find((e) => e.id === bucket)
    if (!entry || !namesClientRole(policy)) continue

    // Read and write are separate axes. `po-archive` is private and no client
    // may write to it, yet its role-gated SELECT policy (00019:41) is correct.
    const isWrite = WRITE_CMDS.includes(policy.cmd)
    const offends = isWrite ? entry.clientWrite === null : entry.allowClientRead === false
    if (!offends) continue

    findings.push({
      kind: 'client_policy',
      subject: policy.policyname,
      message:
        `Policy "${policy.policyname}" gives ${(policy.roles ?? []).join(', ')} ${policy.cmd} ` +
        `on bucket "${bucket}", which is supposed to be reachable only through ${entry.fn} ` +
        `as service_role (mig ${entry.migration}).` +
        (isWrite
          ? ''
          : ' A FOR SELECT policy naming `public` is how public_read_signatures was' +
            ' spelled — it is not narrower than anon, it is broader.'),
    })
  }

  // A bucket nobody declared. Not fatal on its own, but it is how `signatures`
  // stayed public for 109 migrations: nothing enumerated the right answer.
  for (const bucket of buckets) {
    if (!STORAGE_BUCKETS.some((e) => e.id === bucket.id)) {
      findings.push({
        kind: 'unknown_bucket',
        subject: bucket.id,
        message:
          `Bucket "${bucket.id}" (public=${bucket.public}) exists on this target and is not in ` +
          'config/storageBuckets.mjs. Add it there as part of creating it, with what may ' +
          'write to it — an undeclared bucket is an unchecked one.',
      })
    }
  }

  findings.sort((a, b) => a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind))
  return findings
}

/** The bucket ids this check cares about, for the WHERE clause. */
export function expectedBucketIds() {
  return STORAGE_BUCKETS.map((e) => e.id)
}

/** One line per finding, for a terminal. */
export function formatStorageFindings(findings) {
  if (findings.length === 0) {
    return 'Every bucket has its expected visibility, and no client-facing policy exceeds it.'
  }
  return findings.map((f) => `  ✗ ${f.message}`).join('\n')
}

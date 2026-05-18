import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Text-parse smoke tests for the PO Inbox migrations.
//
// Why parse SQL as text? The local toolchain has no live PG to run the
// migrations against. Until an integration test runner is wired up, these
// tests guard against accidental regressions where a future commit drops
// a table, an enum value, an index, or a policy that the rest of the
// system depends on.
//
// They are deliberately lenient on whitespace and casing.

const ROOT = resolve(__dirname, '..');
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), 'utf8');

const PO_INBOX_SQL = read('supabase/migrations/00018_po_inbox.sql');
const PO_ARCHIVE_SQL = read('supabase/migrations/00019_po_archive_bucket.sql');
const REALTIME_CRON_SQL = read('supabase/migrations/00020_po_realtime_and_cron.sql');

const containsCreateTable = (sql: string, table: string): boolean =>
  new RegExp(`CREATE\\s+TABLE\\s+public\\.${table}\\b`, 'i').test(sql);

const containsPolicy = (sql: string, policyName: string): boolean =>
  new RegExp(`CREATE\\s+POLICY\\s+"${policyName}"`, 'i').test(sql);

const containsCheck = (sql: string, column: string, values: string[]): boolean => {
  // Asserts there is a CHECK clause restricting `column` to the listed values.
  // Uses [\s\S] for whitespace so multi-line CHECK lists match.
  const valueList = values.map((v) => `'${v}'`).join(',[\\s\\S]*?');
  return new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\([\\s\\S]*?${valueList}[\\s\\S]*?\\)\\s*\\)`, 'i').test(sql);
};

describe('00018_po_inbox migration', () => {
  describe('tables', () => {
    it.each([
      'email_accounts',
      'oauth_pending_states',
      'inbound_messages',
      'pending_pos',
      'po_customer_aliases',
      'po_product_aliases',
      'po_extraction_audit',
    ])('creates %s', (table) => {
      expect(containsCreateTable(PO_INBOX_SQL, table)).toBe(true);
    });

    it('does NOT persist plaintext OAuth access tokens', () => {
      // Access tokens are not stored at rest — every poll cycle refreshes on
      // demand. Asserting these columns are absent prevents a regression that
      // would reintroduce an at-rest credential.
      expect(/oauth_access_token\b/.test(PO_INBOX_SQL)).toBe(false);
      expect(/oauth_access_expires_at\b/.test(PO_INBOX_SQL)).toBe(false);
    });

    it('rejects obvious plaintext OAuth tokens via CHECK', () => {
      expect(/oauth_refresh_token_encrypted\s+NOT\s+LIKE\s+'1\/\/%'/i.test(PO_INBOX_SQL)).toBe(true);
      expect(/oauth_refresh_token_encrypted\s+NOT\s+LIKE\s+'ya29\.%'/i.test(PO_INBOX_SQL)).toBe(true);
      expect(/oauth_refresh_token_encrypted\s+NOT\s+LIKE\s+'ey%'/i.test(PO_INBOX_SQL)).toBe(true);
    });
  });

  describe('CHECK enums', () => {
    it('restricts email_accounts.provider to gmail/outlook', () => {
      expect(containsCheck(PO_INBOX_SQL, 'provider', ['gmail', 'outlook'])).toBe(true);
    });

    it('restricts email_accounts.status to active/paused/error', () => {
      expect(containsCheck(PO_INBOX_SQL, 'status', ['active', 'paused', 'error'])).toBe(true);
    });

    it('restricts inbound_messages.processing_status to all five values', () => {
      expect(
        containsCheck(PO_INBOX_SQL, 'processing_status', [
          'queued',
          'extracting',
          'extracted',
          'failed',
          'skipped_not_po',
        ]),
      ).toBe(true);
    });

    it('restricts pending_pos.status to all four values', () => {
      expect(
        containsCheck(PO_INBOX_SQL, 'status', [
          'needs_review',
          'approved',
          'rejected',
          'auto_approved',
        ]),
      ).toBe(true);
    });

    it('restricts po_customer_aliases.source_type to all three values', () => {
      expect(
        containsCheck(PO_INBOX_SQL, 'source_type', ['sender_email', 'sender_domain', 'po_text']),
      ).toBe(true);
    });
  });

  describe('foreign keys', () => {
    it('inbound_messages.email_account_id restricts delete (preserves audit trail)', () => {
      expect(/email_account_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.email_accounts\(id\)\s+ON\s+DELETE\s+RESTRICT/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('pending_pos.inbound_message_id is unique and restricts delete', () => {
      expect(/inbound_message_id\s+UUID\s+NOT\s+NULL\s+UNIQUE\s+REFERENCES\s+public\.inbound_messages\(id\)\s+ON\s+DELETE\s+RESTRICT/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('pending_pos.matched_horeca_id references horecas', () => {
      expect(/matched_horeca_id\s+INT\s+REFERENCES\s+public\.horecas\(id\)/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('pending_pos.approved_order_id references orders', () => {
      expect(/approved_order_id\s+TEXT\s+REFERENCES\s+public\.orders\(id\)/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('pending_pos.reviewed_by references profiles (not auth.users)', () => {
      expect(/reviewed_by\s+UUID\s+REFERENCES\s+public\.profiles\(id\)/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('email_accounts.connected_by references profiles', () => {
      expect(/connected_by\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.profiles\(id\)/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('po_product_aliases.product_id references products', () => {
      expect(/product_id\s+INT\s+NOT\s+NULL\s+REFERENCES\s+public\.products\(id\)/i.test(PO_INBOX_SQL)).toBe(true);
    });
  });

  describe('data-integrity CHECKs on pending_pos', () => {
    it('enforces reviewer/reviewed_at co-presence', () => {
      expect(/chk_pending_pos_reviewer_pair/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('requires approved_order_id when status is approved/auto_approved', () => {
      expect(/chk_pending_pos_approved_has_order/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('requires reviewer + rejection_reason on rejected rows', () => {
      expect(/chk_pending_pos_rejected_has_reviewer/i.test(PO_INBOX_SQL)).toBe(true);
    });
  });

  describe('retry_count guard', () => {
    it('caps retry_count between 0 and 10', () => {
      expect(/retry_count\s+INT\s+NOT\s+NULL\s+DEFAULT\s+0\s+CHECK\s*\(\s*retry_count\s*>=\s*0\s+AND\s+retry_count\s*<=\s*10\s*\)/i.test(PO_INBOX_SQL)).toBe(true);
    });
  });

  describe('idempotency constraint', () => {
    it('inbound_messages has UNIQUE (email_account_id, provider_message_id)', () => {
      expect(/UNIQUE\s*\(\s*email_account_id\s*,\s*provider_message_id\s*\)/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('email_accounts has UNIQUE (provider, email_address)', () => {
      expect(/UNIQUE\s*\(\s*provider\s*,\s*email_address\s*\)/i.test(PO_INBOX_SQL)).toBe(true);
    });
  });

  describe('partial unique indexes on po_product_aliases', () => {
    it('uniqueness on (horeca_id, source_code) where source_code is set', () => {
      expect(/CREATE\s+UNIQUE\s+INDEX\s+uq_po_product_aliases_code\s+ON\s+public\.po_product_aliases\s*\(\s*horeca_id\s*,\s*source_code\s*\)\s+WHERE\s+source_code\s+IS\s+NOT\s+NULL/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('uniqueness on (horeca_id, lower(source_description)) where description is set', () => {
      expect(/CREATE\s+UNIQUE\s+INDEX\s+uq_po_product_aliases_desc\s+ON\s+public\.po_product_aliases\s*\(\s*horeca_id\s*,\s*lower\(source_description\)\s*\)\s+WHERE\s+source_description\s+IS\s+NOT\s+NULL/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it('disallows rows with neither source_code nor source_description', () => {
      expect(/CHECK\s*\(\s*source_code\s+IS\s+NOT\s+NULL\s+OR\s+source_description\s+IS\s+NOT\s+NULL\s*\)/i.test(PO_INBOX_SQL)).toBe(true);
    });
  });

  describe('RLS', () => {
    it.each([
      'email_accounts',
      'oauth_pending_states',
      'inbound_messages',
      'pending_pos',
      'po_customer_aliases',
      'po_product_aliases',
      'po_extraction_audit',
    ])('enables RLS on %s', (table) => {
      expect(new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(PO_INBOX_SQL)).toBe(true);
    });

    it('grants Admin/Manager SELECT on the five operator-visible tables', () => {
      expect(containsPolicy(PO_INBOX_SQL, 'email_accounts_select_admin_manager')).toBe(true);
      expect(containsPolicy(PO_INBOX_SQL, 'inbound_messages_select_admin_manager')).toBe(true);
      expect(containsPolicy(PO_INBOX_SQL, 'pending_pos_select_admin_manager')).toBe(true);
      expect(containsPolicy(PO_INBOX_SQL, 'po_customer_aliases_select_admin_manager')).toBe(true);
      expect(containsPolicy(PO_INBOX_SQL, 'po_product_aliases_select_admin_manager')).toBe(true);
    });

    it('restricts po_extraction_audit SELECT to Admin only', () => {
      expect(containsPolicy(PO_INBOX_SQL, 'po_extraction_audit_select_admin')).toBe(true);
    });

    it('grants NO policies of any kind on oauth_pending_states (service_role only)', () => {
      expect(/CREATE\s+POLICY\s+"[^"]*"\s+ON\s+public\.oauth_pending_states/i.test(PO_INBOX_SQL)).toBe(false);
    });

    it('grants NO INSERT/UPDATE/DELETE policies (service_role only)', () => {
      // Negative assertion: no policy starts with the new table names + FOR INSERT/UPDATE/DELETE
      const policyNames = [
        'email_accounts',
        'oauth_pending_states',
        'inbound_messages',
        'pending_pos',
        'po_customer_aliases',
        'po_product_aliases',
        'po_extraction_audit',
      ];
      for (const t of policyNames) {
        const writeRegex = new RegExp(`CREATE\\s+POLICY\\s+"[^"]*${t}[^"]*"\\s+ON\\s+public\\.${t}\\s+FOR\\s+(INSERT|UPDATE|DELETE)`, 'i');
        expect(writeRegex.test(PO_INBOX_SQL)).toBe(false);
      }
    });
  });

  describe('GRANTs', () => {
    it('grants only SELECT to authenticated on the operator-visible tables', () => {
      expect(/GRANT\s+SELECT\s+ON\s+([^;]+)\s+TO\s+authenticated/i.test(PO_INBOX_SQL)).toBe(true);
      // Ensure we are NOT granting INSERT/UPDATE/DELETE on these tables.
      expect(/GRANT\s+(SELECT\s*,\s*)?INSERT[^;]+\b(email_accounts|inbound_messages|pending_pos|po_customer_aliases|po_product_aliases|po_extraction_audit)\b[^;]+TO\s+authenticated/i.test(PO_INBOX_SQL)).toBe(false);
    });

    it('does NOT grant any access to authenticated on oauth_pending_states', () => {
      // The SELECT grant block names tables explicitly; oauth_pending_states
      // must not be in that list.
      const grantBlock = PO_INBOX_SQL.match(/GRANT\s+SELECT\s+ON[\s\S]+?TO\s+authenticated\s*;/i);
      expect(grantBlock).not.toBeNull();
      expect(grantBlock?.[0]).not.toMatch(/oauth_pending_states/i);
    });
  });

  describe('updated_at triggers', () => {
    it('defines a touch_updated_at trigger function', () => {
      expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.touch_updated_at/i.test(PO_INBOX_SQL)).toBe(true);
    });

    it.each(['email_accounts', 'inbound_messages', 'pending_pos'])(
      'wires touch_updated_at to %s',
      (table) => {
        expect(new RegExp(`CREATE\\s+TRIGGER\\s+trg_${table}_updated_at\\s+BEFORE\\s+UPDATE\\s+ON\\s+public\\.${table}`, 'i').test(PO_INBOX_SQL)).toBe(true);
      },
    );
  });
});

describe('00019_po_archive_bucket migration', () => {
  it('creates the private po-archive bucket', () => {
    expect(/INSERT\s+INTO\s+storage\.buckets[\s\S]+?'po-archive'[\s\S]+?false/i.test(PO_ARCHIVE_SQL)).toBe(true);
  });

  it('limits file size and allowed mime types', () => {
    expect(/file_size_limit/i.test(PO_ARCHIVE_SQL)).toBe(true);
    expect(/allowed_mime_types/i.test(PO_ARCHIVE_SQL)).toBe(true);
    expect(/'application\/pdf'/i.test(PO_ARCHIVE_SQL)).toBe(true);
    expect(/'message\/rfc822'/i.test(PO_ARCHIVE_SQL)).toBe(true);
    expect(/'application\/octet-stream'/i.test(PO_ARCHIVE_SQL)).toBe(true);
  });

  it('restricts SELECT on po-archive objects to Admin/Manager', () => {
    expect(containsPolicy(PO_ARCHIVE_SQL, 'po_archive_select_admin_manager')).toBe(true);
    expect(/bucket_id\s*=\s*'po-archive'/i.test(PO_ARCHIVE_SQL)).toBe(true);
    expect(/IN\s*\(\s*'Admin'\s*,\s*'Manager'\s*\)/i.test(PO_ARCHIVE_SQL)).toBe(true);
  });

  it('does not create write policies on storage.objects for po-archive', () => {
    expect(/CREATE\s+POLICY\s+"po_archive_(insert|update|delete|write)/i.test(PO_ARCHIVE_SQL)).toBe(false);
  });
});

describe('00020_po_realtime_and_cron migration', () => {
  it('adds pending_pos and email_accounts to supabase_realtime, idempotently', () => {
    expect(/ADD\s+TABLE\s+public\.pending_pos/i.test(REALTIME_CRON_SQL)).toBe(true);
    expect(/ADD\s+TABLE\s+public\.email_accounts/i.test(REALTIME_CRON_SQL)).toBe(true);
    // Idempotency guards: every ALTER PUBLICATION ... ADD TABLE must be
    // inside a DO block that checks pg_publication_tables first.
    const altersLine = REALTIME_CRON_SQL.split('\n').filter((l) => /ALTER\s+PUBLICATION/i.test(l));
    expect(altersLine.length).toBeGreaterThan(0);
    expect(/DO\s+\$\$[\s\S]+?pg_publication_tables[\s\S]+?ALTER\s+PUBLICATION/i.test(REALTIME_CRON_SQL)).toBe(true);
  });

  it('does NOT add inbound_messages to realtime (PII reduction)', () => {
    expect(/ADD\s+TABLE\s+public\.inbound_messages/i.test(REALTIME_CRON_SQL)).toBe(false);
  });

  it('enables pg_cron and pg_net extensions', () => {
    expect(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_cron/i.test(REALTIME_CRON_SQL)).toBe(true);
    expect(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_net/i.test(REALTIME_CRON_SQL)).toBe(true);
  });

  it('locks down the net schema (SSRF hardening)', () => {
    expect(/REVOKE\s+USAGE\s+ON\s+SCHEMA\s+net\s+FROM\s+anon\s*,\s*authenticated/i.test(REALTIME_CRON_SQL)).toBe(true);
    expect(/REVOKE\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+net\s+FROM\s+anon\s*,\s*authenticated/i.test(REALTIME_CRON_SQL)).toBe(true);
    expect(/ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA\s+net\s+REVOKE\s+EXECUTE\s+ON\s+FUNCTIONS\s+FROM\s+anon\s*,\s*authenticated/i.test(REALTIME_CRON_SQL)).toBe(true);
  });

  it('keeps the cron.schedule snippet commented out (no secret in repo)', () => {
    // The operator-setup snippet must be commented out — otherwise running the
    // migration would attempt to invoke an undeployed function and embed a
    // service-role JWT in version control. Every line mentioning cron.schedule(
    // or net.http_post( must start with the SQL comment marker.
    const lines = REALTIME_CRON_SQL.split('\n');
    const dangerous = lines.filter((line) =>
      /\b(cron\.schedule|cron\.unschedule|net\.http_post)\s*\(/i.test(line),
    );
    expect(dangerous.length).toBeGreaterThan(0); // sanity: snippet exists
    for (const line of dangerous) {
      expect(line.trim().startsWith('--')).toBe(true);
    }
  });
});

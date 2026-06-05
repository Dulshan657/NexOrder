/**
 * Postgres test client for live-DB integration tests.
 *
 * Mirrors the connection logic of `supabase/run-migration.mjs`: direct endpoint
 * `db.<ref>.supabase.co:5432` by default, or the IPv4 session pooler when
 * SUPABASE_DB_REGION is set (the direct endpoint is IPv6-only on the free tier).
 *
 * The cornerstone is `withRollbackTx`: every test body runs inside a single
 * BEGIN … ROLLBACK so the live production database is never mutated, even though
 * the inv_* RPCs (SECURITY DEFINER, service_role-only) are exercised for real.
 * We connect as the database superuser, which may EXECUTE them regardless of the
 * GRANTs; nothing is ever committed.
 */
import './loadEnv';
import pg from 'pg';

// node-pg parses NUMERIC (OID 1700) as a string to avoid precision loss. Our
// inventory quantities are small integers/3-dp decimals well within float range,
// so parse them as numbers to make assertions ergonomic.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export interface PgConnConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: { rejectUnauthorized: boolean };
}

function projectRef(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  return (
    process.env.SUPABASE_PROJECT_REF ||
    url.match(/\/\/([^.]+)\.supabase\.co/)?.[1] ||
    ''
  );
}

export function hasDbCreds(): boolean {
  return Boolean(process.env.SUPABASE_DB_PASSWORD && projectRef());
}

export function buildConfig(): PgConnConfig {
  const password = process.env.SUPABASE_DB_PASSWORD as string;
  const ref = projectRef();
  const region = process.env.SUPABASE_DB_REGION;
  const poolerPrefix = process.env.SUPABASE_POOLER_PREFIX || 'aws-1';

  if (region) {
    return {
      host: `${poolerPrefix}-${region}.pooler.supabase.com`,
      port: 5432,
      database: 'postgres',
      user: `postgres.${ref}`,
      password,
      ssl: { rejectUnauthorized: false },
    };
  }
  return {
    host: `db.${ref}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
  };
}

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client(buildConfig());
  await client.connect();
  return client;
}

/**
 * Run `fn` inside BEGIN … and always ROLLBACK afterwards (then close the
 * connection). The transaction is NEVER committed — production data is untouched.
 */
export async function withRollbackTx(
  fn: (client: pg.Client) => Promise<void>,
): Promise<void> {
  const client = await connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection may already be closed/aborted */
    }
    await client.end();
  }
}

/**
 * Assert that running `sql` raises an error whose message matches `pattern`,
 * isolated by a SAVEPOINT so the outer transaction stays usable afterwards.
 * Proves all-or-nothing atomicity: callers re-read state after this returns and
 * confirm nothing partial leaked.
 */
export async function expectRaise(
  client: pg.Client,
  sql: string,
  params: unknown[],
  pattern: RegExp,
): Promise<void> {
  await client.query('SAVEPOINT sp_expect_raise');
  let raised: Error | null = null;
  try {
    await client.query(sql, params);
  } catch (err) {
    raised = err as Error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT sp_expect_raise');
    await client.query('RELEASE SAVEPOINT sp_expect_raise');
  }
  if (!raised) {
    throw new Error(`Expected query to raise ${pattern} but it succeeded`);
  }
  if (!pattern.test(raised.message)) {
    throw new Error(
      `Expected raised error to match ${pattern} but got: ${raised.message}`,
    );
  }
}

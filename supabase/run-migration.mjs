/**
 * Run migration SQL against Supabase PostgreSQL database.
 * Usage: node supabase/run-migration.mjs
 */
import pg from 'pg'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
  || SUPABASE_URL.match(/\/\/([^.]+)\.supabase\.co/)?.[1]
  || ''

if (!DB_PASSWORD || !PROJECT_REF) {
  console.error('Set SUPABASE_DB_PASSWORD and (SUPABASE_PROJECT_REF or SUPABASE_URL) environment variables')
  process.exit(1)
}

const client = new pg.Client({
  host: `db.${PROJECT_REF}.supabase.co`,
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

async function main() {
  console.log('Connecting to Supabase PostgreSQL...')
  await client.connect()
  console.log('Connected!')

  const migrationFile = process.argv[2] || join(__dirname, 'migrations', '00001_initial_schema.sql')
  const sql = readFileSync(migrationFile, 'utf-8')

  console.log(`Running migration: ${migrationFile}`)
  await client.query(sql)
  console.log('Migration complete!')

  await client.end()
}

main().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})

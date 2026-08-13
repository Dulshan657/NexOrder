/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_IMAGE_CDN_URL?: string
  // Enable Supabase Storage image transforms (render/image CDN). Requires a
  // paid Supabase plan; safe to leave off — the app falls back to raw URLs.
  readonly VITE_SUPABASE_IMAGE_TRANSFORMS?: string
  // Show the demo account roster + shared password on the login screen.
  // Read in components/auth/LoginPage.tsx as `!== 'false'`, so it DEFAULTS ON
  // and a tenant build must set it to the literal string "false" to strip the
  // roster from the bundle. Absent here until 2026-08-13, which is why the
  // mismatch between that read and this interface went unnoticed.
  readonly VITE_SHOW_DEMO_LOGINS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Build-time constants injected by vite.config.ts `define` (B-2 monitoring).
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

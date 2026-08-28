/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_IMAGE_CDN_URL?: string
  // Enable Supabase Storage image transforms (render/image CDN). Requires a
  // paid Supabase plan; safe to leave off — the app falls back to raw URLs.
  readonly VITE_SUPABASE_IMAGE_TRANSFORMS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Build-time constants injected by vite.config.ts `define` (B-2 monitoring).
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

// True only where config/environments.mjs says `kind: 'demo'`. Gates the login
// page's demo-account roster. Replaced VITE_SHOW_DEMO_LOGINS, an opt-out env
// var that shipped working credentials to a tenant by default; see the comment
// beside `isDemoHost` in vite.config.ts.
declare const __DEMO_HOST__: boolean

// The scheduler URL for the login page's "Book a demo" link, or null where
// there is none. Null on every tenant, by registry.
declare const __BOOK_DEMO_URL__: string | null

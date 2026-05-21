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

-- Persist company logo URL in app_settings (replaces localStorage `app_logo`).
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS company_logo_url TEXT;

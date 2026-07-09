// Deno Edge Functions import their dependencies by URL. `tsconfig.json` excludes
// `supabase/functions`, but `exclude` only trims the *default* file set — a file is
// still pulled into the program when an included file imports it, which
// `__tests__/wie/putawayTasks.test.ts` does for `_shared/putawayTasks.ts`. Without
// these declarations `tsc --noEmit` fails to resolve the URL specifiers.
//
// Deno resolves the real modules at runtime and never reads this file.

// `@supabase/supabase-js` is a real dependency, so alias the URL to it and keep
// genuine types (rather than widening `SupabaseClient` to `any`).
declare module 'https://esm.sh/@supabase/supabase-js@2.103.0' {
  export * from '@supabase/supabase-js'
}

// Anything else imported by URL is only ever reached through Deno-side code.
declare module 'https://esm.sh/*'
declare module 'https://deno.land/*'

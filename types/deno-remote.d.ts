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

// `_shared/horecaBody.ts` types its zod argument from the URL the functions pin, and
// a unit test passes in the client's `zod/v3` (same API as the 3.23.8 the functions
// run), so alias the URL to it for the same reason.
declare module 'https://esm.sh/zod@3.23.8' {
  export * from 'zod/v3'
}

// Anything else imported by URL is only ever reached through Deno-side code.
declare module 'https://esm.sh/*'
declare module 'https://deno.land/*'

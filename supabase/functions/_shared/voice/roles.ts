// Who Nex Assistant is offered to, and which of them are sales reps.
//
// Its own file, with NO imports and no tool definitions, because the browser's
// launcher gate (lib/voice/canUseVoiceAssistant.ts) is imported statically by
// AppShell, i.e. by the entry chunk. toolSchemas.ts builds all ten tools with
// module-level calls Rollup cannot tree-shake, so importing the role list from
// there shipped the whole tool contract to tenants without voice_assistant.
// toolSchemas.ts re-exports both arrays, so its existing importers are unchanged.

/** The four roles the assistant is offered to. Anyone else gets no tools. */
export const VOICE_ROLES: readonly string[] = ['Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep']

/** The two sales-rep roles: own-figures scope, no reorder recommendations. */
export const REP_ROLES: readonly string[] = ['Field Sales Rep', 'Office Sales Rep']

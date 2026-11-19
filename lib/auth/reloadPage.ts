// NX-0045: a full page reload, behind a module so tests can observe it.
// Used when the signed-in user changes WITHOUT a sign-out (another tab's
// sign-in, an invite or recovery link opened while signed in): the query cache
// is reset, but the previous person's in-memory state — cart, pantry, profile,
// realtime subscription — only goes away with the page.
export function reloadPage(): void {
  if (typeof window !== 'undefined') window.location.reload()
}

/**
 * Showing a toast must not re-render components that only RAISE toasts.
 * App.tsx raises them, and its context used to carry the toast list too, so
 * every toast shown or dismissed re-rendered App → AppShell → every page.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import React from 'react'
import { ToastProvider, useToastActions, useToasts } from '@/hooks/useToasts'

afterEach(cleanup)

describe('useToastActions', () => {
    it('does not re-render its consumer when toasts change', () => {
        let renders = 0
        let actions: ReturnType<typeof useToastActions> | null = null
        const Raiser = React.memo(function Raiser() {
            renders++
            actions = useToastActions()
            return null
        })
        let listLength = -1
        function List() {
            listLength = useToasts().toasts.length
            return null
        }

        render(<ToastProvider><Raiser /><List /></ToastProvider>)
        const before = renders

        act(() => { actions!.addToast('saved', 'success') })
        act(() => { actions!.addToast('failed', 'error') })

        expect(listLength).toBe(2)
        expect(renders).toBe(before)
    })

    it('returns the same functions across toast changes', () => {
        const seen: Array<ReturnType<typeof useToastActions>> = []
        function Probe() {
            seen.push(useToastActions())
            useToasts()
            return null
        }
        render(<ToastProvider><Probe /></ToastProvider>)
        act(() => { seen[0].addToast('x', 'info') })

        expect(seen.length).toBeGreaterThan(1)
        expect(seen[seen.length - 1]).toBe(seen[0])
    })
})

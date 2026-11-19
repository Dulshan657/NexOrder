// NX-0041 A4. Action rows were `div onClick` with hover-only dismiss/snooze.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Package } from 'lucide-react'
import ActionItemsBoard from '@/components/ActionItemsBoard'

// The board's caller key; useLocalStorage stores it under a version prefix.
const KEY = 'admin_action_items'
const STORED = `nexorder_v1_${KEY}`

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(STORED, JSON.stringify({ collapsed: false, dismissed: [], snoozed: {}, assignments: {} }))
})
afterEach(cleanup)

function board(onClick = vi.fn()) {
  render(
    React.createElement(ActionItemsBoard, {
      title: 'Action Items',
      storageKey: KEY,
      columns: [{
        id: 'stock', label: 'Low stock', icon: Package, severity: 'warning',
        items: [
          { id: 'p1', title: 'Flour 25kg', subtitle: '3 left', onClick },
          { id: 'p2', title: 'Sugar 1kg' },
        ],
      }],
    }),
  )
  return onClick
}

describe('ActionItemsBoard', () => {
  it('a clickable row is a keyboard-operable button', () => {
    const onClick = board()
    const row = screen.getByRole('button', { name: /^flour 25kg/i })
    expect(row.tagName).toBe('BUTTON')
    row.focus()
    expect(document.activeElement).toBe(row)
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledTimes(1)
    // A row with nowhere to go is not dressed as a button.
    expect(screen.queryByRole('button', { name: /^sugar 1kg/i })).toBeNull()
  })

  it('dismiss and snooze are named buttons, and dismissing persists under the same key', () => {
    board()
    expect(screen.getByRole('button', { name: /snooze flour 25kg/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /dismiss flour 25kg/i }))
    expect(screen.queryByText('Flour 25kg')).toBeNull()
    const saved = JSON.parse(localStorage.getItem(STORED) ?? '{}')
    expect(saved.dismissed).toEqual(['p1'])
    expect(Object.keys(saved).sort()).toEqual(['assignments', 'collapsed', 'dismissed', 'snoozed'])
  })
})

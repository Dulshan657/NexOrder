import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RackLevelEditor } from '../components/warehouse/levels/RackLevelEditor'
import type { RackLevel } from '../types'

afterEach(() => {
  cleanup()
})

const LEVELS: RackLevel[] = [
  { levelIndex: 1, role: 'pick', capacitySlots: 2, code: 'A-01-L1' },
  { levelIndex: 2, role: 'pick', capacitySlots: 2, code: 'A-01-L2' },
  { levelIndex: 3, role: 'bulk', capacitySlots: 4, code: 'A-01-L3' },
]

describe('RackLevelEditor', () => {
  it('renders levels TOP level first, even though the prop is bottom-first', () => {
    render(<RackLevelEditor levels={LEVELS} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    // L3 (top) should render before L1 (bottom).
    expect(rows[0].textContent).toContain('L3')
    expect(rows[2].textContent).toContain('L1')
  })

  it('shows a fill percentage when fillByLevel is supplied', () => {
    render(<RackLevelEditor levels={LEVELS} fillByLevel={new Map([[1, 0.5]])} />)
    expect(screen.getByText('50% full')).toBeTruthy()
  })

  it('shows the live location code from codeByLevel over the draft code', () => {
    render(<RackLevelEditor levels={LEVELS} codeByLevel={new Map([[1, 'MAIN-B-4-2-L1']])} />)
    expect(screen.getByText(/MAIN-B-4-2-L1/)).toBeTruthy()
  })

  it('calls onSelectLevel when a row is clicked', () => {
    const onSelectLevel = vi.fn()
    render(<RackLevelEditor levels={LEVELS} onSelectLevel={onSelectLevel} />)
    const rows = screen.getAllByRole('listitem')
    fireEvent.click(rows[0]) // the top row, L3
    expect(onSelectLevel).toHaveBeenCalledWith(3)
  })

  it('calls onChange with a new level added when "Add level" is clicked', () => {
    const onChange = vi.fn()
    render(<RackLevelEditor levels={LEVELS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add level' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as RackLevel[]
    expect(next).toHaveLength(4)
  })

  it('calls onChange with the level removed when its remove button is clicked', () => {
    const onChange = vi.fn()
    render(<RackLevelEditor levels={LEVELS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove level 3' }))
    const next = onChange.mock.calls[0][0] as RackLevel[]
    expect(next).toHaveLength(2)
    expect(next.map((l) => l.levelIndex)).toEqual([1, 2])
  })

  it('calls onChange with the new role when a level\'s role select changes', () => {
    const onChange = vi.fn()
    render(<RackLevelEditor levels={LEVELS} onChange={onChange} />)
    const rows = screen.getAllByRole('listitem')
    const roleSelect = within(rows[2]).getByLabelText('Role') // L1 row (bottom, last rendered)
    fireEvent.change(roleSelect, { target: { value: 'reserve' } })
    const next = onChange.mock.calls[0][0] as RackLevel[]
    expect(next.find((l) => l.levelIndex === 1)?.role).toBe('reserve')
  })

  it('shows "Reset to form standard" only when the current levels diverge from the template, and only when editable', () => {
    const template: RackLevel[] = LEVELS.map((l) => ({ ...l }))
    const { rerender } = render(<RackLevelEditor levels={LEVELS} template={template} />)
    expect(screen.queryByText('Reset to form standard')).toBeNull() // matches template

    const diverged = LEVELS.map((l) => (l.levelIndex === 3 ? { ...l, role: 'reserve' as const } : l))
    rerender(<RackLevelEditor levels={diverged} template={template} />)
    expect(screen.getByText('Reset to form standard')).toBeTruthy()

    rerender(<RackLevelEditor levels={diverged} template={template} readOnly />)
    expect(screen.queryByText('Reset to form standard')).toBeNull()
  })

  it('renders no editable controls or add/remove affordances when readOnly', () => {
    render(<RackLevelEditor levels={LEVELS} readOnly />)
    expect(screen.queryByRole('button', { name: 'Add level' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove level/ })).toBeNull()
    const roleSelect = screen.getAllByLabelText('Role')[0] as HTMLSelectElement
    expect(roleSelect.disabled).toBe(true)
  })
})

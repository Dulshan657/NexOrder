// NX-0041 A6. The shared dashboard parts both pages are rebuilt on.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import RankedList from '@/components/dashboard/RankedList'
import TargetBar from '@/components/dashboard/TargetBar'
import EmptyState from '@/components/dashboard/EmptyState'
import DashCard from '@/components/dashboard/DashCard'
import { formatMoney, pctDelta } from '@/lib/dashboardFormat'

afterEach(cleanup)

describe('RankedList', () => {
  it('renders a row with an action as a button', () => {
    const onClick = vi.fn()
    render(React.createElement(RankedList, {
      label: 'Top customers',
      items: [
        { id: 'a', label: 'Harbour Cafe', value: '$900', share: 1, onClick },
        { id: 'b', label: 'Hilltop Hotel', value: '$450', share: 0.5 },
      ],
    }))
    fireEvent.click(screen.getByRole('button', { name: /harbour cafe/i }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /hilltop hotel/i })).toBeNull()
    expect(screen.getByRole('list', { name: 'Top customers' }).children).toHaveLength(2)
  })

  it('shows its empty message when there are no rows', () => {
    render(React.createElement(RankedList, { label: 'Top reps', items: [], emptyMessage: 'No rep sales yet' }))
    expect(screen.getByText('No rep sales yet')).toBeTruthy()
  })
})

describe('TargetBar', () => {
  it('shows achieved over target, the percent and en-AU dates', () => {
    render(React.createElement(TargetBar, {
      label: 'Revenue', achieved: '$6,000', target: '$12,000', percent: 50,
      startDate: '2026-11-01', endDate: '2026-11-30',
    }))
    expect(screen.getByText('$6,000 / $12,000')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText('1 Nov – 30 Nov')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Revenue' }).getAttribute('aria-valuenow')).toBe('50')
  })
})

describe('EmptyState', () => {
  it('renders its one action', () => {
    const onClick = vi.fn()
    render(React.createElement(EmptyState, { message: 'No visits planned today', action: { label: 'Plan visits', onClick } }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan visits' }))
    expect(onClick).toHaveBeenCalled()
  })
})

describe('DashCard', () => {
  it('renders a titled card with its view-all action', () => {
    const onClick = vi.fn()
    render(React.createElement(DashCard, { title: 'Top products', action: { label: 'View all', onClick } }, 'body'))
    expect(screen.getByRole('heading', { name: 'Top products' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /view all/i }))
    expect(onClick).toHaveBeenCalled()
  })
})

describe('dashboardFormat', () => {
  it('formats money in en-AU dollars', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50')
    expect(formatMoney(1234.5, { cents: false })).toBe('$1,235')
    expect(formatMoney(0)).toBe('$0.00')
  })

  it('pctDelta matches the dashboard rule for a zero previous value', () => {
    expect(pctDelta(150, 100)).toBe(50)
    expect(pctDelta(5, 0)).toBe(100)
    expect(pctDelta(0, 0)).toBe(0)
  })
})

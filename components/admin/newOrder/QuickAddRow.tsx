// Keyboard-first product entry: type a SKU or part of a name, press Enter.
//
// An exact SKU wins outright (case-insensitive), because that is what an
// operator reading a PO aloud types; otherwise Enter takes the highlighted
// suggestion. Arrow keys move the highlight, Escape clears. The parent moves
// focus to the added line's quantity and back here on Enter, so a whole order
// is keyed without the mouse.

import React, { useId, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'

import type { Product } from '../../../types'

const MAX_SUGGESTIONS = 8

interface QuickAddRowProps {
  products: Product[]
  onAdd: (productId: number) => void
  inputRef?: React.Ref<HTMLInputElement>
}

export function matchProducts(products: readonly Product[], query: string): Product[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const exact = products.filter((p) => p.sku.toLowerCase() === q)
  const rest = products.filter(
    (p) => p.sku.toLowerCase() !== q && (p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)),
  )
  return [...exact, ...rest].slice(0, MAX_SUGGESTIONS)
}

export default function QuickAddRow({ products, onAdd, inputRef }: QuickAddRowProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const suggestions = useMemo(() => matchProducts(products, query), [products, query])
  const open = suggestions.length > 0

  const pick = (product: Product | undefined) => {
    if (!product) return
    setQuery('')
    setActive(0)
    onAdd(product.id)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      pick(suggestions[Math.min(active, suggestions.length - 1)])
    } else if (e.key === 'ArrowDown' && open) {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault()
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Escape') {
      setQuery('')
      setActive(0)
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 focus-within:ring-2 focus-within:ring-nexgen-blue-dark">
        <Plus className="w-4 h-4 text-stone-500 shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Add product by SKU or name"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Add a product — type a SKU or name, then Enter"
          autoComplete="off"
          spellCheck={false}
          className="touch-target-y w-full py-2.5 text-sm bg-transparent outline-none placeholder:text-stone-500"
        />
        <Search className="w-4 h-4 text-stone-400 shrink-0 hidden sm:block" aria-hidden="true" />
      </div>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Matching products"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-elevated"
        >
          {suggestions.map((p, i) => (
            <div
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              // mousedown, not click: a click lands after the input's blur.
              onMouseDown={(e: React.MouseEvent) => {
                e.preventDefault()
                pick(p)
              }}
              onMouseEnter={() => setActive(i)}
              className={`touch-target-y flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                i === active ? 'bg-nexgen-blue/10 text-stone-900' : 'text-stone-700'
              }`}
            >
              <span className="min-w-0 truncate">
                <span className="font-mono text-xs text-stone-600 mr-2">{p.sku}</span>
                {p.name}
              </span>
              <span className="shrink-0 font-mono text-xs text-stone-600">{p.available} avail.</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

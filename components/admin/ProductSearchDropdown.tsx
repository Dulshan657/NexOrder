// Searchable product picker for the PO Inbox review modal.
//
// Mirrors the HoReCaSearchDropdown pattern (trigger → search input →
// filtered list, Escape / click-outside to close). Filters on SKU and
// name; shows SKU + carton size as the subtitle so the operator can
// disambiguate similar names. Compact width because it lives inline
// per-line in a dense form.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Package, Search } from 'lucide-react'
import type { Product } from '../../types'

interface ProductSearchDropdownProps {
  products: Product[]
  selectedProductId: number | null
  onSelect: (productId: number) => void
  disabled?: boolean
  error?: string
  placeholder?: string
}

const ProductSearchDropdown: React.FC<ProductSearchDropdownProps> = ({
  products,
  selectedProductId,
  onSelect,
  disabled,
  error,
  placeholder = 'Select product',
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = selectedProductId != null
    ? products.find(p => p.id === selectedProductId)
    : undefined

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products.slice(0, 200)
    return products
      .filter(p =>
        p.name.toLowerCase().includes(q)
        || p.sku.toLowerCase().includes(q),
      )
      .slice(0, 200)
  }, [products, query])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          setIsOpen(open => !open)
          if (!isOpen) setTimeout(() => inputRef.current?.focus(), 30)
        }}
        className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-sm transition-colors ${
          disabled
            ? 'border-stone-200 bg-stone-100 text-stone-400 cursor-not-allowed'
            : error
              ? 'border-rose-400 bg-rose-50 text-rose-700'
              : selected
                ? 'border-stone-300 bg-white text-stone-900 hover:border-stone-400'
                : 'border-stone-300 bg-white text-stone-500 hover:border-stone-400'
        }`}
      >
        <Package className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        <span className="flex-1 text-left truncate">
          {selected ? `${selected.sku} · ${selected.name}` : placeholder}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {error && <p className="text-rose-500 text-xs mt-1">{error}</p>}

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-40 overflow-hidden min-w-[280px]">
          <div className="p-2 border-b border-stone-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by SKU or name…"
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md bg-stone-50 border-0 ring-1 ring-inset ring-stone-200 focus:ring-2 focus:ring-nexgen-blue placeholder:text-stone-400 focus:outline-none"
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setIsOpen(false)
                    setQuery('')
                  }
                }}
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-stone-400 text-center">No matches</p>
            ) : (
              filtered.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onSelect(p.id)
                    setIsOpen(false)
                    setQuery('')
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    p.id === selectedProductId
                      ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium'
                      : 'text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  <span className="block truncate">{p.name}</span>
                  <span className="block text-xs text-stone-400 truncate mt-0.5">
                    {p.sku} · carton {p.cartonSize}
                    {Number.isFinite(p.price) && p.price > 0 ? ` · $${p.price.toFixed(2)}` : ''}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ProductSearchDropdown

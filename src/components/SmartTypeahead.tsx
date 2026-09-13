'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'

const MAX_SHOWN = 5

interface SmartTypeaheadProps<T> {
  query: string
  onQueryChange: (value: string) => void
  suggestions: T[]
  onSelect: (item: T) => void
  getKey: (item: T) => string
  renderSuggestion: (item: T, active: boolean) => React.ReactNode
  placeholder?: string
  className?: string
  loading?: boolean
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
}

export default function SmartTypeahead<T>({
  query,
  onQueryChange,
  suggestions,
  onSelect,
  getKey,
  renderSuggestion,
  placeholder,
  className,
  loading = false,
  autoFocus = false,
  inputRef: externalInputRef,
}: SmartTypeaheadProps<T>) {
  const internalRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef ?? internalRef
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const visible = suggestions.slice(0, MAX_SHOWN)

  const updatePosition = useCallback(() => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }, [inputRef])

  useEffect(() => {
    if (visible.length > 0 && query.trim()) {
      updatePosition()
      setOpen(true)
    } else {
      setOpen(false)
    }
    setActiveIdx(0)
  }, [visible.length, query, updatePosition])

  useEffect(() => {
    if (!open) return
    const onReposition = () => updatePosition()
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [inputRef])

  const handleSelect = (item: T) => {
    onSelect(item)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || visible.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, visible.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (visible[activeIdx]) handleSelect(visible[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const dropdown = open ? (
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="bg-white border border-[#D4D4D8] shadow-xl overflow-hidden"
    >
      {loading && visible.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[#A1A1AA]">Searching…</div>
      ) : (
        visible.map((item, i) => (
          <button
            key={getKey(item)}
            type="button"
            onMouseDown={() => handleSelect(item)}
            onMouseEnter={() => setActiveIdx(i)}
            className="w-full text-left"
          >
            {renderSuggestion(item, i === activeIdx)}
          </button>
        ))
      )}
    </div>
  ) : null

  return (
    <div className="relative">
      <div className={className ?? 'flex items-center gap-2 border border-[#D4D4D8] bg-white px-3 py-2 focus-within:border-[#27272A] transition-colors'}>
        <Search size={13} className="text-[#A1A1AA] flex-shrink-0" />
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onFocus={() => {
            if (visible.length > 0 && query.trim()) {
              updatePosition()
              setOpen(true)
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onMouseDown={() => { onQueryChange(''); setOpen(false) }}
            className="text-[#A1A1AA] hover:text-[#27272A] flex-shrink-0"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {typeof document !== 'undefined' && dropdown
        ? createPortal(dropdown, document.body)
        : null}
    </div>
  )
}

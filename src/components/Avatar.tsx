'use client'

import React from 'react'
import Image from 'next/image'
import { useProfileCard } from '@/contexts/ProfileCardContext'

interface AvatarProps {
  avatarUrl?: string | null
  name?: string | null
  email?: string | null
  size?: number          // pixel size (width = height)
  className?: string
  /** When provided, clicking the avatar opens that user's profile card. */
  userId?: string
}

/** Renders a circular avatar: image if avatarUrl is set, otherwise initials.
 *  Pass `userId` to make the avatar clickable — it will open the global profile card. */
export default function Avatar({ avatarUrl, name, email, size = 36, className = '', userId }: AvatarProps) {
  const profileCard = useProfileCard()

  const initials =
    name
      ?.split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ||
    email?.charAt(0).toUpperCase() ||
    '?'

  const style = { width: size, height: size, minWidth: size, minHeight: size }

  const clickProps = userId
    ? {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation()
          profileCard.openProfileCard(userId)
        },
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            profileCard.openProfileCard(userId)
          }
        },
        title: name ? `View ${name}'s profile` : 'View profile',
        className: `cursor-pointer hover:ring-2 hover:ring-indigo-400 hover:ring-offset-1 transition-shadow`,
      }
    : {}

  if (avatarUrl) {
    return (
      <div
        style={style}
        {...clickProps}
        className={`rounded-full overflow-hidden flex-shrink-0 bg-slate-200 ${clickProps.className ?? ''} ${className}`}
      >
        <Image
          src={avatarUrl}
          alt={name || 'Avatar'}
          width={size}
          height={size}
          className="object-cover w-full h-full"
          unoptimized
        />
      </div>
    )
  }

  // Gradient fallback with initials
  return (
    <div
      style={{ ...style, background: 'linear-gradient(to bottom right, var(--brand-primary), var(--brand-secondary))' }}
      {...clickProps}
      className={`rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold ${clickProps.className ?? ''} ${className}`}
    >
      <span style={{ fontSize: Math.max(10, size * 0.38) }}>{initials}</span>
    </div>
  )
}

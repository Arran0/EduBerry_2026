'use client'

import React, { useCallback, useState } from 'react'
import Image from 'next/image'
import { useProfileCard, type ProfileCardSeed } from '@/contexts/ProfileCardContext'

interface AvatarProps {
  avatarUrl?: string | null
  name?: string | null
  email?: string | null
  size?: number          // pixel size (width = height)
  className?: string
  /** When provided, clicking the avatar opens that user's profile card. */
  userId?: string
  /** The profile the caller already holds, so the card opens fully drawn
   *  rather than as a spinner that resizes. */
  profileSeed?: ProfileCardSeed | null
  /** Makes the avatar clickable with a handler of its own — for people with no
   *  account (support staff), whose card is opened by the caller. */
  onOpen?: () => void
}

/** Renders a circular avatar: image if avatarUrl is set, otherwise initials.
 *  Pass `userId` to make the avatar clickable — it will open the global profile card. */
export default function Avatar({ avatarUrl, name, email, size = 36, className = '', userId, profileSeed, onOpen }: AvatarProps) {
  const profileCard = useProfileCard()
  // Whether the photo has painted. Until it has, the initials sit underneath
  // instead of a grey disc, and the photo fades in over them — no blank frame
  // between "nothing" and "face", which is what read as a blink wherever a
  // face appears at a new size (a profile card opening, a popup header).
  // A photo already in the cache reports complete on mount and skips the fade.
  const [loaded, setLoaded] = useState(false)
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true)
  }, [])

  // Whatever the list already knows about this person goes with the click, so
  // the card opens with their name and face already drawn (see ProfileCard).
  const open = () => {
    if (onOpen) { onOpen(); return }
    if (!userId) return
    const seed: ProfileCardSeed = {
      id: userId,
      ...(name ? { full_name: name } : {}),
      ...(email ? { email } : {}),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      ...(profileSeed && profileSeed.id === userId ? profileSeed : {}),
    }
    profileCard.openProfileCard(userId, seed)
  }

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

  const clickProps = userId || onOpen
    ? {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation()
          open()
        },
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            open()
          }
        },
        title: name ? `View ${name}'s profile` : 'View profile',
        className: `cursor-pointer hover:ring-2 hover:ring-indigo-400 hover:ring-offset-1 transition-shadow`,
      }
    : {}

  if (avatarUrl) {
    return (
      <div
        style={{ ...style, background: 'linear-gradient(to bottom right, var(--brand-primary), var(--brand-secondary))' }}
        {...clickProps}
        // keep-round: a face stays a circle even on the square-cornered
        // (pro-chrome) staff pages — see globals.css.
        className={`keep-round relative rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-white font-bold ${clickProps.className ?? ''} ${className}`}
      >
        {!loaded && <span aria-hidden style={{ fontSize: Math.max(10, size * 0.38) }}>{initials}</span>}
        <Image
          ref={imgRef}
          src={avatarUrl}
          alt={name || 'Avatar'}
          width={size}
          height={size}
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 object-cover w-full h-full transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
    )
  }

  // Gradient fallback with initials
  return (
    <div
      style={{ ...style, background: 'linear-gradient(to bottom right, var(--brand-primary), var(--brand-secondary))' }}
      {...clickProps}
      className={`brand-fade keep-round rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold ${clickProps.className ?? ''} ${className}`}
    >
      <span style={{ fontSize: Math.max(10, size * 0.38) }}>{initials}</span>
    </div>
  )
}

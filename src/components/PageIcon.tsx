import React from 'react'
import {
  ClipboardList, Megaphone, GraduationCap, Home, BookOpen,
  Calendar, CalendarDays, Users, UserPlus, BarChart3,
  Bell, Star, Award, Target, Layers, Grid,
  FileText, MessageSquare, Settings, TrendingUp,
  CheckSquare, Zap, CreditCard, Pencil,
  FolderOpen, ListChecks, Lightbulb, Newspaper,
  LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  ClipboardList, Megaphone, GraduationCap, Home, BookOpen,
  Calendar, CalendarDays, Users, UserPlus, BarChart3,
  Bell, Star, Award, Target, Layers, Grid,
  FileText, MessageSquare, Settings, TrendingUp,
  CheckSquare, Zap, CreditCard, Pencil,
  FolderOpen, ListChecks, Lightbulb, Newspaper,
}

interface PageIconProps {
  iconName: string
  gradientFrom: string
  gradientTo: string
  size?: number
  className?: string
}

export default function PageIcon({ iconName, gradientFrom, gradientTo, size = 24, className = '' }: PageIconProps) {
  const Icon = ICON_MAP[iconName] ?? ClipboardList
  return (
    <div className={`p-2.5 bg-gradient-to-br ${gradientFrom} ${gradientTo} rounded-xl shadow-lg ${className}`}>
      <Icon className="text-white" size={size} />
    </div>
  )
}

export function getIconComponent(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? ClipboardList
}

export { ICON_MAP }

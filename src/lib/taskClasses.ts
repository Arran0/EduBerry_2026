// Grade + section labels on tasks ("7B", "LKG A"). A task can be for several
// classes; they are stored as labels in tasks.classes and shown after the task
// name, so a period brought in from the timetable reads "7B" until the teacher
// names it, and "Fractions recap · 7B" after.

import { gradeLabel } from './grades'

export interface ClassSource {
  name?: string | null
  grade: number | null
  section: string | null
}

/** "7B" for Grade 7 section B, "LKG A" for a pre-primary class. */
export function classLabel(h: ClassSource): string {
  const section = (h.section ?? '').trim()
  if (h.grade == null) return (h.name ?? section).trim()
  if (h.grade > 0) return `${h.grade}${section}`
  return section ? `${gradeLabel(h.grade)} ${section}` : gradeLabel(h.grade)
}

const PRE_PRIMARY: Record<string, number> = { 'pre-kg': -3, lkg: -2, ukg: -1 }

/** Grade order, then section: Pre-KG A, LKG A, 1A, 1B, 10A. */
function classSortKey(label: string): [number, string] {
  const m = label.match(/^(\d+)\s*(.*)$/)
  if (m) return [Number(m[1]), m[2]]
  const [head, ...rest] = label.split(/\s+/)
  const g = PRE_PRIMARY[head.toLowerCase()]
  return g != null ? [g, rest.join(' ')] : [100, label]
}

export function sortClassLabels(labels: Iterable<string>): string[] {
  return [...new Set(labels)].filter(Boolean).sort((a, b) => {
    const [ga, sa] = classSortKey(a)
    const [gb, sb] = classSortKey(b)
    return ga !== gb ? ga - gb : sa.localeCompare(sb, undefined, { numeric: true })
  })
}

/** The task name with its classes after it: "Fractions recap · 7B, 7C". */
export function taskDisplayTitle(t: { title: string; classes?: string[] | null }): string {
  const name = t.title.trim()
  const classes = (t.classes ?? []).join(', ')
  if (!classes) return name || 'Untitled task'
  return name ? `${name} · ${classes}` : classes
}

import { ClassroomWithDetails } from './classrooms'

const STORAGE_KEY = 'classroom_visits'

type VisitMap = Record<string, number>

function readVisits(): VisitMap {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as VisitMap
  } catch {
    return {}
  }
}

export function recordClassroomVisit(classroomId: string): void {
  if (typeof window === 'undefined') return
  const visits = readVisits()
  visits[classroomId] = Date.now()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(visits))
}

// Returns classrooms sorted: most recently visited first, unvisited after (preserving original order).
export function sortByLastVisited(classrooms: ClassroomWithDetails[]): ClassroomWithDetails[] {
  const visits = readVisits()
  return [...classrooms].sort((a, b) => {
    const ta = visits[a.id] ?? 0
    const tb = visits[b.id] ?? 0
    if (ta === 0 && tb === 0) return 0  // both unvisited — preserve original order
    return tb - ta
  })
}

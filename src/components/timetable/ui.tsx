// The admin workspace design kit now lives in a shared location so non-timetable
// pages (e.g. staff attendance) can adopt the same aesthetic. Re-exported here so
// existing relative `./ui` imports across the timetable feature keep working.
export * from '@/components/workspace/ui'
export type { SegItem, SmartOption } from '@/components/workspace/ui'

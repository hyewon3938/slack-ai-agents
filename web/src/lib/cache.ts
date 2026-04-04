import { unstable_cache } from 'next/cache';
import {
  querySchedulesByRange,
  queryBacklogSchedules,
  queryCategories,
} from '@/features/schedule/lib/queries';
import {
  queryRoutineTemplates,
  queryRoutineRecords,
  queryRoutineStats,
  queryRoutinePerStats,
} from '@/features/routine/lib/queries';

const REVALIDATE_SECONDS = 30;

export const getCachedSchedulesByRange = (userId: number, from: string, to: string) =>
  unstable_cache(
    async () => querySchedulesByRange(userId, from, to),
    ['schedules-by-range', String(userId), from, to],
    { revalidate: REVALIDATE_SECONDS, tags: ['schedules'] },
  )();

export const getCachedBacklogSchedules = (userId: number) =>
  unstable_cache(
    async () => queryBacklogSchedules(userId),
    ['backlog-schedules', String(userId)],
    { revalidate: REVALIDATE_SECONDS, tags: ['schedules'] },
  )();

export const getCachedCategories = (userId: number) =>
  unstable_cache(
    async () => queryCategories(userId),
    ['categories', String(userId)],
    { revalidate: REVALIDATE_SECONDS, tags: ['categories'] },
  )();

// ─── 루틴 ────────────────────────────────────────────

export const getCachedRoutineTemplates = (userId: number) =>
  unstable_cache(
    async () => queryRoutineTemplates(userId),
    ['routines', String(userId)],
    { revalidate: REVALIDATE_SECONDS, tags: ['routines'] },
  )();

export const getCachedRoutineRecords = (userId: number, date: string) =>
  unstable_cache(
    async () => queryRoutineRecords(userId, date),
    ['routine-records', String(userId), date],
    { revalidate: REVALIDATE_SECONDS, tags: ['routine-records'] },
  )();

export const getCachedRoutineStats = (userId: number, from: string, to: string) =>
  unstable_cache(
    async () => queryRoutineStats(userId, from, to),
    ['routine-stats', String(userId), from, to],
    { revalidate: REVALIDATE_SECONDS, tags: ['routine-stats'] },
  )();

export const getCachedRoutinePerStats = (userId: number, from: string, to: string) =>
  unstable_cache(
    async () => queryRoutinePerStats(userId, from, to),
    ['routine-per-stats', String(userId), from, to],
    { revalidate: REVALIDATE_SECONDS, tags: ['routine-stats'] },
  )();

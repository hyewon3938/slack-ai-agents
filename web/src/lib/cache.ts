import { unstable_cache } from 'next/cache';
import {
  querySchedulesByRange,
  queryBacklogSchedules,
  queryCategories,
} from '@/features/schedule/lib/queries';

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

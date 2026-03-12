import { unstable_cache } from 'next/cache';
import {
  querySchedulesByRange,
  queryBacklogSchedules,
  queryCategories,
} from '@/features/schedule/lib/queries';

const REVALIDATE_SECONDS = 30;

export const getCachedSchedulesByRange = unstable_cache(
  async (from: string, to: string) => querySchedulesByRange(from, to),
  ['schedules-by-range'],
  { revalidate: REVALIDATE_SECONDS, tags: ['schedules'] },
);

export const getCachedBacklogSchedules = unstable_cache(
  async () => queryBacklogSchedules(),
  ['backlog-schedules'],
  { revalidate: REVALIDATE_SECONDS, tags: ['schedules'] },
);

export const getCachedCategories = unstable_cache(
  async () => queryCategories(),
  ['categories'],
  { revalidate: REVALIDATE_SECONDS, tags: ['categories'] },
);

import { DEFAULT_USER_ID } from '../../shared/user-resolver.js';
import type { WeeklyReportData } from './types.js';
import { aggregateWeeklySleep } from './aggregate-sleep.js';
import { aggregateWeeklyRoutine } from './aggregate-routine.js';
import { aggregateWeeklySchedule } from './aggregate-schedule.js';
import { aggregateSleepRoutineCorrelation } from './aggregate-correlation.js';
import { aggregateSajuOutcome } from './aggregate-saju.js';

// ─── 통합 집계 ──────────────────────────────────────────

export const aggregateWeeklyReport = async (
  weekStart: string,
  weekEnd: string,
  userId: number = DEFAULT_USER_ID,
): Promise<WeeklyReportData> => {
  const [sleep, routine, schedule, correlation, saju] = await Promise.all([
    aggregateWeeklySleep(weekStart, weekEnd, userId),
    aggregateWeeklyRoutine(weekStart, weekEnd, userId),
    aggregateWeeklySchedule(weekStart, weekEnd, userId),
    aggregateSleepRoutineCorrelation(weekStart, weekEnd, userId),
    aggregateSajuOutcome(userId),
  ]);

  return { sleep, routine, schedule, correlation, saju, weekStart, weekEnd };
};

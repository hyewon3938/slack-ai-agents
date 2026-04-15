import { calcCycleDays } from '../billing/cycle';
import type { BillingCycle } from '../types-v2';

/** today 기준 현재 주기의 경과/남은 일수 */
export function calcAllocatedDays(
  today: string,
  cycle: BillingCycle,
): { elapsed: number; remaining: number; allocatedDays: number } {
  const remaining = calcCycleDays(today, cycle.to);
  const elapsed = cycle.totalDays - remaining;
  return { elapsed, remaining, allocatedDays: remaining };
}

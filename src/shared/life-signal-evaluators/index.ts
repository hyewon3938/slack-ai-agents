/**
 * life_signal trigger_aux.kind dispatcher (마스터 #434 Phase 3, ADR-0029).
 *
 * pattern_catalog.trigger_target_type='life_signal' 시드는 trigger_aux.kind로 8개 evaluator 분기.
 * kind: weekday / weekday_group / month_position / season / calendar_event / lunar / threshold / behavior_baseline
 *
 * 평가 결과는 boolean — true면 오늘 trigger 발현, false면 미발현.
 * 잘못된 aux는 saju-match.ts:isLifeSignalAux에서 걸러진 후 들어오므로 여기서는 예외 X.
 */

import type { DailyContext, LifeSignalAux } from '../saju-match.js';
import { evaluateWeekday, evaluateWeekdayGroup } from './weekday.js';
import { evaluateMonthPosition } from './month-position.js';
import { evaluateSeason } from './season.js';
import { evaluateCalendarEvent } from './calendar-event.js';
import { evaluateLunar } from './lunar.js';
import { evaluateThreshold } from './threshold.js';
import { evaluateBehaviorBaseline } from './behavior-baseline.js';

export const dispatchLifeSignal = async (
  aux: LifeSignalAux,
  ctx: DailyContext,
): Promise<boolean> => {
  switch (aux.kind) {
    case 'weekday':
      return evaluateWeekday(aux, ctx);
    case 'weekday_group':
      return evaluateWeekdayGroup(aux, ctx);
    case 'month_position':
      return evaluateMonthPosition(aux, ctx);
    case 'season':
      return evaluateSeason(aux, ctx);
    case 'calendar_event':
      return evaluateCalendarEvent(aux, ctx);
    case 'lunar':
      return evaluateLunar(aux, ctx);
    case 'threshold':
      return evaluateThreshold(aux, ctx);
    case 'behavior_baseline':
      return evaluateBehaviorBaseline(aux, ctx);
  }
};

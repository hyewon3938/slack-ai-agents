/**
 * life_signal trigger_aux 타입과 type guard (pattern-match에서 분리).
 */
// ─── life_signal trigger_aux 타입 (ADR-0029) ───────────────
// Phase 3 (마스터 #434) — life_signal 단일 type + trigger_aux.kind 분기
// 7 kinds: weekday / weekday_group / month_position / season / calendar_event / threshold / behavior_baseline
// (lunar는 폐기 — 사주는 절기 기준이지 음력 기준이 아니다. 명절은 calendar_event(holiday/holiday_next)로 커버.)

export type WeekdayDow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WeekdayAux {
  kind: 'weekday';
  dow: WeekdayDow;
}

export interface WeekdayGroupAux {
  kind: 'weekday_group';
  group: 'weekend' | 'weekday';
}

export interface MonthPositionAux {
  kind: 'month_position';
  position: 'start' | 'end' | 'mid';
  range_days?: number;
  start?: number;
  end?: number;
}

export interface SeasonAux {
  kind: 'season';
  season: 'spring' | 'summer' | 'autumn' | 'winter';
}

export interface CalendarEventAux {
  kind: 'calendar_event';
  event: 'holiday' | 'holiday_next' | 'autopay_day';
  day_of_month?: number;
}

export interface ThresholdAux {
  kind: 'threshold';
  source: 'sleep_minutes' | 'routine_streak_max';
  op: 'lte' | 'gte' | 'eq';
  value: number;
}

export type BehaviorSignalName =
  | 'streak'
  | 'sleepTrend'
  | 'slotGap'
  | 'weekComparison'
  | 'overdueAlert'
  | 'categorySkew'
  | 'drift'
  | 'recovery'
  | 'lapseAlert'
  | 'weeklyRegression'
  | 'spottyPattern';

export interface BehaviorBaselineAux {
  kind: 'behavior_baseline';
  signal_name: BehaviorSignalName;
}

export type LifeSignalAux =
  | WeekdayAux
  | WeekdayGroupAux
  | MonthPositionAux
  | SeasonAux
  | CalendarEventAux
  | ThresholdAux
  | BehaviorBaselineAux;

const BEHAVIOR_SIGNAL_NAMES: ReadonlySet<string> = new Set<BehaviorSignalName>([
  'streak',
  'sleepTrend',
  'slotGap',
  'weekComparison',
  'overdueAlert',
  'categorySkew',
  'drift',
  'recovery',
  'lapseAlert',
  'weeklyRegression',
  'spottyPattern',
]);

/** trigger_aux JSONB를 LifeSignalAux로 안전하게 좁히는 type guard. 잘못된 aux는 false 반환(예외 X). */
export const isLifeSignalAux = (v: unknown): v is LifeSignalAux => {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  const kind = obj['kind'];
  switch (kind) {
    case 'weekday':
      return typeof obj['dow'] === 'number' && obj['dow'] >= 0 && obj['dow'] <= 6;
    case 'weekday_group':
      return obj['group'] === 'weekend' || obj['group'] === 'weekday';
    case 'month_position':
      return obj['position'] === 'start' || obj['position'] === 'end' || obj['position'] === 'mid';
    case 'season':
      return (
        obj['season'] === 'spring' ||
        obj['season'] === 'summer' ||
        obj['season'] === 'autumn' ||
        obj['season'] === 'winter'
      );
    case 'calendar_event':
      return (
        obj['event'] === 'holiday' ||
        obj['event'] === 'holiday_next' ||
        obj['event'] === 'autopay_day'
      );
    case 'threshold':
      return (
        (obj['source'] === 'sleep_minutes' || obj['source'] === 'routine_streak_max') &&
        (obj['op'] === 'lte' || obj['op'] === 'gte' || obj['op'] === 'eq') &&
        typeof obj['value'] === 'number'
      );
    case 'behavior_baseline':
      return (
        typeof obj['signal_name'] === 'string' && BEHAVIOR_SIGNAL_NAMES.has(obj['signal_name'])
      );
    default:
      return false;
  }
};

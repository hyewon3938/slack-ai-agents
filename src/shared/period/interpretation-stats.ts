/** 기간 해석 — 누적 기술통계 집계(inline SQL). */

import { getJeolgiMonthRange } from '../saju/pillars.js';
import { type Jiji } from '../saju/types.js';
import { query } from '../db.js';
import { addDays } from '../kst.js';
import type { PeriodContext, DescriptiveStats } from './types.js';

// ─── 누적 기술통계 (inline SQL) ──────────────────────────

const JEOLGI_TABLE_MIN_YEAR = 2024; // 절기 테이블 하한 — 이전으로는 walk 중단
const MAX_SAME_JIJI_RANGES = 5; // wolun 과거 동일 월지 구간 상한(백스톱)

/** wolun: 과거 동일 월지 절기월 구간들(데이터 하한까지, 백스톱 cap). 결정론. */
const pastSameJijiRanges = (
  currentStart: string,
  jiji: Jiji,
): Array<{ start: string; end: string }> => {
  const ranges: Array<{ start: string; end: string }> = [];
  let cursor = addDays(currentStart, -1);
  while (ranges.length < MAX_SAME_JIJI_RANGES) {
    if (Number(cursor.slice(0, 4)) < JEOLGI_TABLE_MIN_YEAR) break;
    let r: { start: string; end: string; jiji: Jiji };
    try {
      r = getJeolgiMonthRange(cursor);
    } catch {
      break; // 테이블 범위 밖 → 중단
    }
    if (r.jiji === jiji) ranges.push({ start: r.start, end: r.end });
    cursor = addDays(r.start, -1);
  }
  return ranges;
};

interface RangeSql {
  clause: string;
  params: unknown[];
}

/** ranges → "(col BETWEEN $i AND $i+1 OR ...)" + 파라미터. startIdx = 다음 placeholder 번호. */
const buildRangeClause = (
  ranges: ReadonlyArray<{ start: string; end: string }>,
  col: string,
  startIdx: number,
): RangeSql => {
  const parts: string[] = [];
  const params: unknown[] = [];
  let i = startIdx;
  for (const r of ranges) {
    parts.push(`${col} BETWEEN $${i} AND $${i + 1}`);
    params.push(r.start, r.end);
    i += 2;
  }
  return { clause: `(${parts.join(' OR ')})`, params };
};

interface SleepStatRow {
  avg_duration: number | null;
  cnt: number;
}
interface RoutineStatRow {
  done: number;
  total: number;
}
interface DiaryStatRow {
  cnt: number;
}

/** 구간 목록에 대해 sleep/routine/diary 누적 집계. 구간 없으면 전부 null. */
const aggregateLifeStats = async (
  userId: number,
  ranges: ReadonlyArray<{ start: string; end: string }>,
): Promise<Pick<DescriptiveStats, 'sleep' | 'routine' | 'diary'>> => {
  if (ranges.length === 0) return { sleep: null, routine: null, diary: null };

  // 분할 수면 정합: 날짜별 합산을 1 레코드로 본 뒤 평균·건수 집계 (세그먼트 단위 평균 왜곡 방지)
  const sleepRange = buildRangeClause(ranges, 'date', 2);
  const sleepRes = await query<SleepStatRow>(
    `SELECT ROUND(AVG(day_minutes))::int AS avg_duration, COUNT(*)::int AS cnt
       FROM (
         SELECT date, SUM(duration_minutes) AS day_minutes
           FROM sleep_records
          WHERE sleep_type = 'night' AND duration_minutes IS NOT NULL
            AND user_id = $1 AND ${sleepRange.clause}
          GROUP BY date
       ) d`,
    [userId, ...sleepRange.params],
  );
  const routineRange = buildRangeClause(ranges, 'r.date', 2);
  const routineRes = await query<RoutineStatRow>(
    `SELECT COUNT(*) FILTER (WHERE r.completed)::int AS done, COUNT(*)::int AS total
       FROM routine_records r
       JOIN routine_templates t ON r.template_id = t.id
      WHERE r.user_id = $1 AND r.date >= t.created_at::date AND ${routineRange.clause}
        AND r.entry_type = 'scheduled'`,
    [userId, ...routineRange.params],
  );
  const diaryRange = buildRangeClause(ranges, 'date', 2);
  const diaryRes = await query<DiaryStatRow>(
    `SELECT COUNT(*)::int AS cnt FROM diary_entries
      WHERE user_id = $1 AND ${diaryRange.clause}`,
    [userId, ...diaryRange.params],
  );

  const sleepRow = sleepRes.rows[0];
  const routineRow = routineRes.rows[0];
  const diaryRow = diaryRes.rows[0];
  return {
    sleep:
      sleepRow && sleepRow.cnt > 0
        ? { avgDuration: sleepRow.avg_duration ?? 0, recordCount: sleepRow.cnt }
        : null,
    routine:
      routineRow && routineRow.total > 0
        ? { rate: Math.round((routineRow.done / routineRow.total) * 100), total: routineRow.total }
        : null,
    diary: diaryRow && diaryRow.cnt > 0 ? { count: diaryRow.cnt } : null,
  };
};

/** 기술통계 빌드 — wolun=과거 동일 월지 누적 / seun·daeun=기간 시작~현재. */
export const buildDescriptiveStats = async (
  ctx: PeriodContext,
  range: { start: string; end: string | null },
  userId: number,
  today: string,
): Promise<DescriptiveStats> => {
  if (ctx.periodType === 'wolun') {
    const ranges = pastSameJijiRanges(range.start, ctx.branch);
    const stats = await aggregateLifeStats(userId, ranges);
    const scope =
      ranges.length === 0
        ? `과거 같은 ${ctx.branch}월(절기달) 기록이 아직 없어 — 이번이 처음 쌓는 구간이야`
        : `과거 같은 ${ctx.branch}월(절기달) ${ranges.length}개 누적`;
    return { scope, rangeCount: ranges.length, ...stats };
  }
  // seun/daeun: 기간 시작 ~ 오늘(현재까지)
  const end = range.end && range.end < today ? range.end : today;
  const ranges = range.start <= end ? [{ start: range.start, end }] : [];
  const stats = await aggregateLifeStats(userId, ranges);
  const label = ctx.periodType === 'seun' ? '올해(입춘 기준)' : '이번 대운';
  const scope = ranges.length === 0 ? `${label} 시작 전` : `${label} 시작 이후 ~ 오늘`;
  return { scope, rangeCount: ranges.length, ...stats };
};

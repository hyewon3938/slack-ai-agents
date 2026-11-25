/**
 * 루틴 쿼리: 타입 · 빈도 헬퍼 · 템플릿/기록 조회와 변경.
 */

import { query } from '../db.js';
import { diffDays } from '../kst.js';

// ─── 타입 ───────────────────────────────────────────────

/** 추적 방식 — scheduled=빈도대로 기대된 발생, free=수행 시점에만 기록 (ADR-0061) */
export type RoutineTrackingMode = 'scheduled' | 'free';

export interface RoutineTemplateRow {
  id: number;
  name: string;
  time_slot: string;
  frequency: string | null;
  start_date: string;
  tracking_mode: RoutineTrackingMode;
}

export interface RoutineRecordRow {
  id: number;
  template_id: number;
  date: string;
  completed: boolean;
  completed_at: string | null;
  memo: string | null;
  name: string; // JOIN routine_templates
  time_slot: string; // JOIN
  frequency: string | null; // JOIN
}

// ─── 빈도 헬퍼 ─────────────────────────────────────────

/**
 * 빈도에서 간격 일수 추출 (예: '3일마다' → 3, '격일' → 2, '주1회' → 7). 매일이나 해석할 수 없는 값은 null.
 * 웹 `web/src/features/routine/lib/types.ts`의 parseIntervalDays와 같은 규칙이다 — 한쪽을 바꾸면 다른 쪽도 맞춘다.
 */
const parseIntervalDays = (frequency: string): number | null => {
  if (frequency === '격일') return 2;
  if (frequency === '주1회') return 7;
  const match = /^(\d+)일마다$/.exec(frequency);
  if (!match) return null;
  const days = Number(match[1]);
  return days >= 1 ? days : null;
};

/** 허용 목록(NULL·매일·격일·주1회·N일마다) 밖 빈도인지 — 이런 템플릿은 기록을 만들지 않는다 */
export const isUnknownFrequency = (frequency: string | null): boolean =>
  !!frequency && frequency !== '매일' && parseIntervalDays(frequency) === null;

/**
 * 빈도에 따라 오늘 기록을 생성해야 하는지 판별.
 * 웹 ensureTodayRecords의 shouldCreateToday와 같은 결과를 낸다 (같은 케이스 표로 양쪽을 테스트).
 */
export const shouldCreateToday = (
  frequency: string | null,
  lastDate: string | null,
  today: string,
  startDate?: string | null,
): boolean => {
  // 시작일이 미래면 생성하지 않음 (YYYY-MM-DD는 사전순 비교 = 시간순 비교)
  if (startDate && today < startDate) return false;

  // 빈도 없음(NULL)은 매일로 본다
  if (!frequency || frequency === '매일') return true;

  // 허용 목록 밖 빈도는 주기를 알 수 없으므로 만들지 않는다 (예전엔 매일로 취급했다)
  const intervalDays = parseIntervalDays(frequency);
  if (!intervalDays) return false;

  // 간격 빈도(격일, N일마다, 주1회): start_date 기준 모듈러 연산
  if (startDate) {
    const gap = diffDays(startDate, today);
    return gap >= 0 && gap % intervalDays === 0;
  }

  // startDate 없는 경우 (폴백): gap 기반
  if (!lastDate) return true;
  return diffDays(lastDate, today) >= intervalDays;
};

/** 빈도 → 표시용 배지 텍스트 (매일은 빈 문자열) */
export const frequencyBadge = (frequency: string | null): string => {
  if (!frequency) return '';
  if (frequency === '주1회') return '_(1주 마다)_';
  const intervalDays = parseIntervalDays(frequency);
  if (intervalDays) return `_(${intervalDays}일 마다)_`;
  return '';
};

// ─── 루틴 쿼리 ──────────────────────────────────────────

/**
 * 활성 루틴 템플릿 전체 조회.
 * 추적 모드로 필터하지 않는다 — 자율 루틴도 활성 루틴이므로 "활성 루틴 N개" 표시가 거짓이 된다.
 * 모드 분기는 기록 생성 경로(createTodayRecords) 한 곳에서만 건다 (ADR-0061).
 */
export const queryActiveTemplates = async (userId: number): Promise<RoutineTemplateRow[]> =>
  (
    await query<RoutineTemplateRow>(
      'SELECT id, name, time_slot, frequency, start_date::text, tracking_mode FROM routine_templates WHERE active = true AND user_id = $1 ORDER BY id',
      [userId],
    )
  ).rows;

/** 특정 날짜의 루틴 기록 조회 (템플릿 JOIN) */
export const queryTodayRecords = async (
  today: string,
  userId: number,
): Promise<RoutineRecordRow[]> =>
  (
    await query<RoutineRecordRow>(
      `SELECT r.id, r.template_id, r.date::text, r.completed, r.completed_at::text, r.memo,
            t.name, t.time_slot, t.frequency
     FROM routine_records r
     JOIN routine_templates t ON r.template_id = t.id
     WHERE r.date = $1 AND r.user_id = $2
       AND r.entry_type = 'scheduled'
     ORDER BY
       CASE t.time_slot
         WHEN '낮' THEN 1 WHEN '밤' THEN 2
       END, t.name`,
      [today, userId],
    )
  ).rows;

/** 특정 날짜에 이미 생성된 기록의 template_id 집합 */
export const queryExistingTemplateIds = async (
  today: string,
  userId: number,
): Promise<Set<number>> => {
  const rows = (
    await query<{ template_id: number }>(
      // 자율 기록은 주기형 행의 생성을 막지 않는다 (ADR-0061, 웹 ensureTodayRecords와 같은 조건)
      "SELECT template_id FROM routine_records WHERE date = $1 AND user_id = $2 AND entry_type = 'scheduled'",
      [today, userId],
    )
  ).rows;
  return new Set(rows.map((r) => r.template_id));
};

/** 특정 템플릿의 가장 최근 주기형 기록 날짜 (자율 기록은 빈도 판정에 쓰지 않는다) */
export const queryLastRecordDate = async (
  templateId: number,
  userId: number,
): Promise<string | null> => {
  const result = await query<{ date: string }>(
    "SELECT date::text FROM routine_records WHERE template_id = $1 AND user_id = $2 AND entry_type = 'scheduled' ORDER BY date DESC LIMIT 1",
    [templateId, userId],
  );
  return result.rows[0]?.date ?? null;
};

/** 루틴 기록 생성 — 기대된 발생을 미리 만드는 자리 (entry_type을 DEFAULT에 맡기지 않고 명시) */
export const createRecord = async (
  templateId: number,
  today: string,
  userId: number,
): Promise<number> => {
  const result = await query<{ id: number }>(
    "INSERT INTO routine_records (template_id, date, completed, user_id, entry_type) VALUES ($1, $2, false, $3, 'scheduled') RETURNING id",
    [templateId, today, userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createRecord: INSERT returned no rows');
  return row.id;
};

/** 루틴 완료 처리 (완료 시점 기록) */
export const completeRecord = async (id: number, userId: number): Promise<void> => {
  await query(
    'UPDATE routine_records SET completed = true, completed_at = NOW() WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
};

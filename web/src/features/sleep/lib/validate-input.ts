import { validateFields } from '@/lib/validation';
import { SLEEP_TAGS, type SleepRecordInput, type SleepEventInput } from './types';

/** 수면 기록/이벤트 입력 검증 (API 라우트 공용, #595) */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_TAGS = new Set<string>(SLEEP_TAGS);

/** 검증 결과 — 실패면 error, 성공이면 정규화된 data */
export type ParseResult<T> = { error: string } | { data: T };

/** HH:MM 시각 또는 null/미지정 여부 (bedtime·wake_time은 NULL 허용) */
function isTimeOrNull(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && TIME_RE.test(v));
}

/** SleepRecordInput 검증 + 정규화 (POST/PATCH 공용). duration은 서버가 SQL로 계산 */
export function parseSleepRecordInput(body: unknown): ParseResult<SleepRecordInput> {
  if (typeof body !== 'object' || body === null) {
    return { error: '요청 본문이 올바르지 않습니다' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.date !== 'string' || !DATE_RE.test(b.date)) {
    return { error: 'date가 필요합니다 (YYYY-MM-DD)' };
  }
  if (b.sleep_type !== 'night' && b.sleep_type !== 'nap') {
    return { error: 'sleep_type은 night 또는 nap이어야 합니다' };
  }
  if (!isTimeOrNull(b.bedtime)) {
    return { error: 'bedtime 형식이 올바르지 않습니다 (HH:MM 또는 null)' };
  }
  if (!isTimeOrNull(b.wake_time)) {
    return { error: 'wake_time 형식이 올바르지 않습니다 (HH:MM 또는 null)' };
  }

  let tags: string[] | undefined;
  if (b.tags !== undefined && b.tags !== null) {
    if (
      !Array.isArray(b.tags) ||
      !b.tags.every((t) => typeof t === 'string' && VALID_TAGS.has(t))
    ) {
      return { error: '유효하지 않은 tags입니다 (허용 어휘 밖 값 포함)' };
    }
    tags = b.tags as string[];
  }

  if (b.memo !== undefined && b.memo !== null && typeof b.memo !== 'string') {
    return { error: 'memo는 문자열이어야 합니다' };
  }
  const lengthError = validateFields([[b.memo, 'memo']]);
  if (lengthError) return { error: lengthError };

  return {
    data: {
      date: b.date,
      sleep_type: b.sleep_type,
      bedtime: (b.bedtime ?? null) as string | null,
      wake_time: (b.wake_time ?? null) as string | null,
      tags,
      memo: (b.memo ?? null) as string | null,
    },
  };
}

/** SleepEventInput 검증 + 정규화. event_time은 필수(중간기상 시각) */
export function parseSleepEventInput(body: unknown): ParseResult<SleepEventInput> {
  if (typeof body !== 'object' || body === null) {
    return { error: '요청 본문이 올바르지 않습니다' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.date !== 'string' || !DATE_RE.test(b.date)) {
    return { error: 'date가 필요합니다 (YYYY-MM-DD)' };
  }
  if (typeof b.event_time !== 'string' || !TIME_RE.test(b.event_time)) {
    return { error: 'event_time 형식이 올바르지 않습니다 (HH:MM)' };
  }
  if (b.memo !== undefined && b.memo !== null && typeof b.memo !== 'string') {
    return { error: 'memo는 문자열이어야 합니다' };
  }
  const lengthError = validateFields([[b.memo, 'memo']]);
  if (lengthError) return { error: lengthError };

  return {
    data: {
      date: b.date,
      event_time: b.event_time,
      memo: (b.memo ?? null) as string | null,
    },
  };
}

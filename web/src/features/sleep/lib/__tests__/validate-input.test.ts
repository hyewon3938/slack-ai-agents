import { describe, it, expect } from 'vitest';

import { parseSleepRecordInput, parseSleepEventInput } from '../validate-input';

// ─── 합성 픽스처 (실제 개인 데이터 아님) ───────────────────────────────
// API 라우트가 DB에 넘기기 전 마지막 관문이라, 거절 경계와 정규화 결과를 고정한다.

const VALID_RECORD = {
  date: '2026-07-11',
  sleep_type: 'night',
  bedtime: '23:30',
  wake_time: '07:30',
};

const VALID_EVENT = {
  date: '2026-07-11',
  event_time: '03:20',
};

function isError(result: object): boolean {
  return 'error' in result;
}

describe('parseSleepRecordInput — 거절', () => {
  it('객체가 아닌 본문(null·문자열·숫자)은 거절한다', () => {
    expect(isError(parseSleepRecordInput(null))).toBe(true);
    expect(isError(parseSleepRecordInput('night'))).toBe(true);
    expect(isError(parseSleepRecordInput(42))).toBe(true);
  });

  it('date가 없거나 YYYY-MM-DD 형식이 아니면 거절한다', () => {
    expect(isError(parseSleepRecordInput({ ...VALID_RECORD, date: undefined }))).toBe(true);
    expect(isError(parseSleepRecordInput({ ...VALID_RECORD, date: '2026-7-11' }))).toBe(true);
  });

  it('sleep_type이 night·nap 밖이면 거절한다', () => {
    expect(isError(parseSleepRecordInput({ ...VALID_RECORD, sleep_type: 'morning' }))).toBe(true);
    expect(isError(parseSleepRecordInput({ ...VALID_RECORD, sleep_type: undefined }))).toBe(true);
  });

  it('24:00·9:30·23:60 같은 시각 형식은 거절한다', () => {
    for (const bad of ['24:00', '9:30', '23:60']) {
      expect(isError(parseSleepRecordInput({ ...VALID_RECORD, bedtime: bad }))).toBe(true);
      expect(isError(parseSleepRecordInput({ ...VALID_RECORD, wake_time: bad }))).toBe(true);
    }
  });

  it('허용 어휘 밖 태그가 하나라도 섞이면 거절한다', () => {
    const result = parseSleepRecordInput({ ...VALID_RECORD, tags: ['악몽', '꿀잠'] });
    expect(isError(result)).toBe(true);
  });

  it('배열이 아닌 tags(문자열)는 거절한다', () => {
    expect(isError(parseSleepRecordInput({ ...VALID_RECORD, tags: '악몽' }))).toBe(true);
  });

  it('memo가 숫자면 거절한다', () => {
    expect(isError(parseSleepRecordInput({ ...VALID_RECORD, memo: 123 }))).toBe(true);
  });

  it('memo가 500자를 넘으면 거절하고 500자는 통과시킨다', () => {
    expect(isError(parseSleepRecordInput({ ...VALID_RECORD, memo: 'a'.repeat(501) }))).toBe(true);
    expect(isError(parseSleepRecordInput({ ...VALID_RECORD, memo: 'a'.repeat(500) }))).toBe(false);
  });
});

describe('parseSleepRecordInput — 정규화', () => {
  it('bedtime·wake_time이 null이거나 빠져도 통과하고 null로 채운다', () => {
    const result = parseSleepRecordInput({
      date: '2026-07-11',
      sleep_type: 'nap',
      bedtime: null,
    });

    expect(result).toEqual({
      data: {
        date: '2026-07-11',
        sleep_type: 'nap',
        bedtime: null,
        wake_time: null,
        tags: undefined,
        memo: null,
      },
    });
  });

  it('허용 어휘 태그 배열은 그대로 전달한다', () => {
    const result = parseSleepRecordInput({ ...VALID_RECORD, tags: ['악몽', '카페인'] });

    expect(result).toEqual({
      data: expect.objectContaining({ tags: ['악몽', '카페인'] }),
    });
  });

  it('tags가 null이면 거절하지 않고 미지정(undefined)으로 둔다', () => {
    const result = parseSleepRecordInput({ ...VALID_RECORD, tags: null });

    expect(isError(result)).toBe(false);
    expect('data' in result && result.data.tags).toBeUndefined();
  });

  it('본문에 섞인 알 수 없는 키는 결과에 싣지 않는다', () => {
    const result = parseSleepRecordInput({ ...VALID_RECORD, user_id: 99, duration_minutes: 1 });

    expect('data' in result && Object.keys(result.data).sort()).toEqual(
      ['bedtime', 'date', 'memo', 'sleep_type', 'tags', 'wake_time'].sort(),
    );
  });
});

describe('parseSleepEventInput', () => {
  it('객체가 아닌 본문은 거절한다', () => {
    expect(isError(parseSleepEventInput(null))).toBe(true);
    expect(isError(parseSleepEventInput('03:20'))).toBe(true);
  });

  it('event_time이 빠지거나 null이면 거절한다 (필수)', () => {
    expect(isError(parseSleepEventInput({ date: '2026-07-11' }))).toBe(true);
    expect(isError(parseSleepEventInput({ ...VALID_EVENT, event_time: null }))).toBe(true);
  });

  it('event_time 형식이 HH:MM이 아니면 거절한다', () => {
    expect(isError(parseSleepEventInput({ ...VALID_EVENT, event_time: '24:00' }))).toBe(true);
    expect(isError(parseSleepEventInput({ ...VALID_EVENT, event_time: '3:20' }))).toBe(true);
  });

  it('memo가 숫자이거나 500자를 넘으면 거절한다', () => {
    expect(isError(parseSleepEventInput({ ...VALID_EVENT, memo: 1 }))).toBe(true);
    expect(isError(parseSleepEventInput({ ...VALID_EVENT, memo: 'a'.repeat(501) }))).toBe(true);
  });

  it('memo가 빠지면 null로 채운다', () => {
    expect(parseSleepEventInput(VALID_EVENT)).toEqual({
      data: { date: '2026-07-11', event_time: '03:20', memo: null },
    });
  });
});

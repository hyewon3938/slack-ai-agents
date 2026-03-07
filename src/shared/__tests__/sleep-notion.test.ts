import { describe, it, expect } from 'vitest';
import {
  parseSleepTimes,
  convertKoreanNumbers,
  calculateSleepMinutes,
  formatSleepDuration,
  formatTimeHHMM,
  calculateSleepStats,
} from '../sleep-notion.js';
import type { SleepRecord } from '../sleep-notion.js';

// ─── convertKoreanNumbers ─────────────────────────────────────────────

describe('convertKoreanNumbers', () => {
  it('한시~아홉시', () => {
    expect(convertKoreanNumbers('한시')).toBe('1시');
    expect(convertKoreanNumbers('두시')).toBe('2시');
    expect(convertKoreanNumbers('아홉시')).toBe('9시');
  });

  it('열시~열두시', () => {
    expect(convertKoreanNumbers('열시')).toBe('10시');
    expect(convertKoreanNumbers('열한시')).toBe('11시');
    expect(convertKoreanNumbers('열두시')).toBe('12시');
  });

  it('문맥 포함: "새벽 두시에 자고 아침 아홉시 반에 일어났어"', () => {
    expect(convertKoreanNumbers('새벽 두시에 자고 아침 아홉시 반에 일어났어'))
      .toBe('새벽 2시에 자고 아침 9시 반에 일어났어');
  });

  it('숫자 없으면 그대로', () => {
    expect(convertKoreanNumbers('오늘 날씨 좋다')).toBe('오늘 날씨 좋다');
  });

  it('아라비아 숫자는 건드리지 않음', () => {
    expect(convertKoreanNumbers('11시에 자서 7시에 일어남')).toBe('11시에 자서 7시에 일어남');
  });
});

// ─── parseSleepTimes ──────────────────────────────────────────────────

describe('parseSleepTimes', () => {
  it('기본 패턴: "12시에 자서 7시에 일어났어"', () => {
    const result = parseSleepTimes('12시에 자서 7시에 일어났어');
    expect(result).toEqual({ bedtime: '00:00', wakeTime: '07:00' });
  });

  it('반 포함: "11시 반에 잤어 6시 반에 일어남"', () => {
    const result = parseSleepTimes('11시 반에 잤어 6시 반에 일어남');
    expect(result).toEqual({ bedtime: '23:30', wakeTime: '06:30' });
  });

  it('분 포함: "10시 30분에 잠들었어 7시 15분에 일어났어"', () => {
    const result = parseSleepTimes('10시 30분에 잠들었어 7시 15분에 일어났어');
    expect(result).toEqual({ bedtime: '22:30', wakeTime: '07:15' });
  });

  it('명시적 오전/오후: "오후 10시에 잠들었어 오전 6시에 일어남"', () => {
    const result = parseSleepTimes('오후 10시에 잠들었어 오전 6시에 일어남');
    expect(result).toEqual({ bedtime: '22:00', wakeTime: '06:00' });
  });

  it('새벽 취침: "새벽 2시에 자서 10시에 일어남"', () => {
    const result = parseSleepTimes('새벽 2시에 자서 10시에 일어남');
    expect(result).toEqual({ bedtime: '02:00', wakeTime: '10:00' });
  });

  it('밤 취침: "밤 11시에 잤어 아침 7시에 일어났어"', () => {
    const result = parseSleepTimes('밤 11시에 잤어 아침 7시에 일어났어');
    expect(result).toEqual({ bedtime: '23:00', wakeTime: '07:00' });
  });

  it('저녁 취침: "저녁 9시에 잠들었어 5시에 일어남"', () => {
    const result = parseSleepTimes('저녁 9시에 잠들었어 5시에 일어남');
    expect(result).toEqual({ bedtime: '21:00', wakeTime: '05:00' });
  });

  it('자연어 포함: "어제 1시에 자서 오늘 8시에 일어났어"', () => {
    const result = parseSleepTimes('어제 1시에 자서 오늘 8시에 일어났어');
    expect(result).toEqual({ bedtime: '01:00', wakeTime: '08:00' });
  });

  it('자고 패턴: "11시에 자고 6시에 일어남"', () => {
    const result = parseSleepTimes('11시에 자고 6시에 일어남');
    expect(result).toEqual({ bedtime: '23:00', wakeTime: '06:00' });
  });

  it('취침 키워드: "10시 취침 7시 기상"', () => {
    const result = parseSleepTimes('10시 취침 7시 기상');
    expect(result).toEqual({ bedtime: '22:00', wakeTime: '07:00' });
  });

  it('파싱 실패: 취침만 있음', () => {
    expect(parseSleepTimes('12시에 잤어')).toBeNull();
  });

  it('파싱 실패: 기상만 있음', () => {
    expect(parseSleepTimes('7시에 일어났어')).toBeNull();
  });

  it('파싱 실패: 관련 없는 문장', () => {
    expect(parseSleepTimes('오늘 날씨 좋다')).toBeNull();
  });

  // 한글 숫자 테스트
  it('한글 숫자: "두시에 자서 아홉시에 일어났어"', () => {
    const result = parseSleepTimes('두시에 자서 아홉시에 일어났어');
    expect(result).toEqual({ bedtime: '02:00', wakeTime: '09:00' });
  });

  it('한글 숫자 + 반: "새벽 두시에 자고 아홉시 반에 일어났어"', () => {
    const result = parseSleepTimes('새벽 두시에 자고 아홉시 반에 일어났어');
    expect(result).toEqual({ bedtime: '02:00', wakeTime: '09:30' });
  });

  it('한글 숫자: "열한시에 잤어 여섯시에 일어남"', () => {
    const result = parseSleepTimes('열한시에 잤어 여섯시에 일어남');
    expect(result).toEqual({ bedtime: '23:00', wakeTime: '06:00' });
  });

  it('한글 숫자: "열두시에 자서 일곱시에 일어났어"', () => {
    const result = parseSleepTimes('열두시에 자서 일곱시에 일어났어');
    expect(result).toEqual({ bedtime: '00:00', wakeTime: '07:00' });
  });

  it('한글+아라비아 혼용: "열한시에 자고 7시에 일어남"', () => {
    const result = parseSleepTimes('열한시에 자고 7시에 일어남');
    expect(result).toEqual({ bedtime: '23:00', wakeTime: '07:00' });
  });
});

// ─── calculateSleepMinutes ────────────────────────────────────────────

describe('calculateSleepMinutes', () => {
  it('같은 날: 01:00~08:00 = 420분', () => {
    expect(calculateSleepMinutes('01:00', '08:00')).toBe(420);
  });

  it('overnight: 23:30~07:00 = 450분', () => {
    expect(calculateSleepMinutes('23:30', '07:00')).toBe(450);
  });

  it('overnight: 00:00~07:00 = 420분', () => {
    expect(calculateSleepMinutes('00:00', '07:00')).toBe(420);
  });

  it('overnight: 22:00~06:00 = 480분', () => {
    expect(calculateSleepMinutes('22:00', '06:00')).toBe(480);
  });

  it('새벽: 02:00~10:00 = 480분', () => {
    expect(calculateSleepMinutes('02:00', '10:00')).toBe(480);
  });

  it('짧은 수면: 03:00~06:30 = 210분', () => {
    expect(calculateSleepMinutes('03:00', '06:30')).toBe(210);
  });
});

// ─── formatSleepDuration ──────────────────────────────────────────────

describe('formatSleepDuration', () => {
  it('정각: 420분 → "7시간"', () => {
    expect(formatSleepDuration(420)).toBe('7시간');
  });

  it('30분 포함: 450분 → "7시간 30분"', () => {
    expect(formatSleepDuration(450)).toBe('7시간 30분');
  });

  it('15분 포함: 375분 → "6시간 15분"', () => {
    expect(formatSleepDuration(375)).toBe('6시간 15분');
  });
});

// ─── formatTimeHHMM ───────────────────────────────────────────────────

describe('formatTimeHHMM', () => {
  it('일반: 420 → "07:00"', () => {
    expect(formatTimeHHMM(420)).toBe('07:00');
  });

  it('자정 넘김: 1440 → "00:00"', () => {
    expect(formatTimeHHMM(1440)).toBe('00:00');
  });

  it('24시간 이상 보정: 1470 → "00:30"', () => {
    expect(formatTimeHHMM(1470)).toBe('00:30');
  });

  it('저녁: 1410 → "23:30"', () => {
    expect(formatTimeHHMM(1410)).toBe('23:30');
  });
});

// ─── calculateSleepStats ──────────────────────────────────────────────

describe('calculateSleepStats', () => {
  it('빈 배열 → null', () => {
    expect(calculateSleepStats([])).toBeNull();
  });

  it('단일 기록 통계', () => {
    const records: SleepRecord[] = [
      { id: '1', date: '2026-03-06', bedtime: '23:30', wakeTime: '07:00', durationMinutes: 450, memo: '' },
    ];
    const stats = calculateSleepStats(records);
    expect(stats).toEqual({
      count: 1,
      avgDurationMinutes: 450,
      avgBedtimeMinutes: 1410, // 23*60+30
      avgWakeTimeMinutes: 420, // 7*60
    });
  });

  it('여러 기록 평균 (overnight 보정)', () => {
    const records: SleepRecord[] = [
      { id: '1', date: '2026-03-05', bedtime: '23:00', wakeTime: '07:00', durationMinutes: 480, memo: '' },
      { id: '2', date: '2026-03-06', bedtime: '01:00', wakeTime: '08:00', durationMinutes: 420, memo: '' },
      // 23:00 = 1380분, 01:00 = 60+1440=1500분 (overnight 보정)
      // 평균 취침: (1380+1500)/2 = 1440분 = 00:00
      // 평균 기상: (420+480)/2 = 450분 = 07:30
    ];
    const stats = calculateSleepStats(records);
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(2);
    expect(stats!.avgDurationMinutes).toBe(450);
    expect(stats!.avgBedtimeMinutes).toBe(1440);
    expect(stats!.avgWakeTimeMinutes).toBe(450);
  });
});

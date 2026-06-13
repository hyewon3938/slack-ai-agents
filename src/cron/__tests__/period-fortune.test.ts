import { describe, it, expect } from 'vitest';
import { decidePeriodTriggers } from '../period-fortune.js';

// 대운 미등록(평일·절기 케이스용)
const NO_DAEUN = { birthDate: null, daewunList: [] };

describe('decidePeriodTriggers (게이트 4분기)', () => {
  it('평일(전환 없음) → no-op (빈 배열)', () => {
    const triggers = decidePeriodTriggers('2026-06-13', NO_DAEUN);
    expect(triggers).toHaveLength(0);
  });

  it('절기 전환일(소서 2026-07-07) → 월운만', () => {
    const triggers = decidePeriodTriggers('2026-07-07', NO_DAEUN);
    expect(triggers).toHaveLength(1);
    const t = triggers[0];
    expect(t.periodType).toBe('wolun');
    expect(t.periodStart).toBe('2026-07-07'); // 절기 전환일 = 절기월 시작
    expect(t.periodEnd).toBe('2026-08-06'); // 다음 절기(입추 08-07) 전날
    expect(t.pillar.jiji).toBe('미'); // 소서 → 미월
  });

  it('⚡ 입춘(2026-02-04) → 월운+세운 동시 (double-trigger, 독립 검사)', () => {
    const triggers = decidePeriodTriggers('2026-02-04', NO_DAEUN);
    expect(triggers).toHaveLength(2);
    const types = triggers.map((t) => t.periodType).sort();
    expect(types).toEqual(['seun', 'wolun']);

    const wolun = triggers.find((t) => t.periodType === 'wolun');
    const seun = triggers.find((t) => t.periodType === 'seun');
    expect(wolun?.pillar.jiji).toBe('인'); // 입춘 = 인월 전환
    expect(seun?.periodStart).toBe('2026-02-04');
    expect(seun?.periodEnd).toBe('2027-02-03'); // 다음 입춘(2027-02-04) 전날
    expect(seun?.pillar.hangul).toBe('병오'); // 2026 = 병오년
  });

  it('대운 전환일(첫 대운 시작) → 대운', () => {
    // 2023-06-13 출생 → 2026-06-13에 만 3세 진입(어제는 2세). 첫 대운 age=3.
    const natal = { birthDate: '2023-06-13', daewunList: [{ age: 3, pillar: '갑자' }] };
    const triggers = decidePeriodTriggers('2026-06-13', natal);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].periodType).toBe('daeun');
    expect(triggers[0].pillar.hangul).toBe('갑자');
    expect(triggers[0].periodStart).toBe('2026-06-13');
    expect(triggers[0].periodEnd).toBeNull();
  });

  it('대운 변화 없는 날 → 대운 트리거 없음', () => {
    // 같은 대운 구간 내(어제도 오늘도 갑자) → 전환 아님
    const natal = { birthDate: '2023-06-13', daewunList: [{ age: 3, pillar: '갑자' }] };
    const triggers = decidePeriodTriggers('2026-06-20', natal);
    expect(triggers.filter((t) => t.periodType === 'daeun')).toHaveLength(0);
  });

  it('입춘 + 대운 전환이 같은 날이면 3개 동시 (완전 독립 검사)', () => {
    // 입춘(2026-02-04)에 첫 대운도 시작하도록 출생일 설정 (2024-02-04 출생 → 2026-02-04 만 2세)
    const natal = { birthDate: '2024-02-04', daewunList: [{ age: 2, pillar: '갑자' }] };
    const triggers = decidePeriodTriggers('2026-02-04', natal);
    const types = triggers.map((t) => t.periodType).sort();
    expect(types).toEqual(['daeun', 'seun', 'wolun']);
  });
});

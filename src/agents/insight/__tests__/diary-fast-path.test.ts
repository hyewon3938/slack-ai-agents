import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/db.js', () => ({ query: vi.fn() }));
vi.mock('../../../shared/llm.js', () => ({ createDiaryMetaLLMClient: vi.fn() }));
vi.mock('../../../cron/diary-meta-extract.js', () => ({ extractAndPersistForUser: vi.fn() }));

const { resolveDiaryDate, parseDatedDiary, formatDatedConfirmation } =
  await import('../diary-fast-path.js');

// ─── resolveDiaryDate ───────────────────────────────────

describe('resolveDiaryDate', () => {
  it('올해 지난 날짜는 올해로 해석한다', () => {
    expect(resolveDiaryDate(10, 21, '2026-10-22')).toBe('2026-10-21');
  });

  it('오늘 날짜는 오늘로 해석한다', () => {
    expect(resolveDiaryDate(10, 22, '2026-10-22')).toBe('2026-10-22');
  });

  it('올해 기준 미래 날짜는 작년으로 해석한다', () => {
    expect(resolveDiaryDate(12, 10, '2027-01-05')).toBe('2026-12-10');
    expect(resolveDiaryDate(10, 23, '2026-10-22')).toBe('2025-10-23');
  });

  it('존재하지 않는 날짜는 null', () => {
    expect(resolveDiaryDate(13, 1, '2026-10-22')).toBeNull();
    expect(resolveDiaryDate(0, 1, '2026-10-22')).toBeNull();
    expect(resolveDiaryDate(2, 30, '2026-10-22')).toBeNull();
    expect(resolveDiaryDate(4, 31, '2026-10-22')).toBeNull();
    expect(resolveDiaryDate(10, 0, '2026-10-22')).toBeNull();
  });

  it('윤년 2/29는 해당 연도가 윤년일 때만 인정한다', () => {
    expect(resolveDiaryDate(2, 29, '2028-03-01')).toBe('2028-02-29');
    expect(resolveDiaryDate(2, 29, '2027-03-01')).toBeNull();
  });
});

// ─── parseDatedDiary ────────────────────────────────────

describe('parseDatedDiary', () => {
  const today = '2026-10-22';

  it('날짜 접두 + 공백 + 본문', () => {
    expect(parseDatedDiary('10/21 산책했다', today)).toEqual({
      kind: 'dated',
      date: '2026-10-21',
      content: '산책했다',
    });
  });

  it('날짜 뒤 줄바꿈도 접두로 인정하고 본문 줄바꿈은 유지한다', () => {
    expect(parseDatedDiary('10/21\n첫 줄\n둘째 줄', today)).toEqual({
      kind: 'dated',
      date: '2026-10-21',
      content: '첫 줄\n둘째 줄',
    });
  });

  it('한 자리 월·일과 0 채운 표기 모두 받는다', () => {
    expect(parseDatedDiary('3/5 봄', today)).toMatchObject({ date: '2026-03-05' });
    expect(parseDatedDiary('03/05 봄', today)).toMatchObject({ date: '2026-03-05' });
  });

  it('날짜가 맨 앞이 아니면 접두가 아니다', () => {
    expect(parseDatedDiary('오늘은 10/21 생각이 났다', today)).toEqual({ kind: 'none' });
  });

  it('날짜에 글자가 붙어 있으면 접두가 아니다', () => {
    expect(parseDatedDiary('10/21에 친구 만난 거 생각남', today)).toEqual({ kind: 'none' });
  });

  it('없는 날짜는 invalid_date', () => {
    expect(parseDatedDiary('2/30 뭔가', today)).toEqual({ kind: 'invalid_date', token: '2/30' });
  });

  it('날짜만 있고 본문이 없으면 no_content', () => {
    expect(parseDatedDiary('10/21', today)).toEqual({ kind: 'no_content' });
    expect(parseDatedDiary('10/21   ', today)).toEqual({ kind: 'no_content' });
  });
});

// ─── formatDatedConfirmation ────────────────────────────

describe('formatDatedConfirmation', () => {
  it('올해 날짜는 연도 없이 표시한다', () => {
    expect(formatDatedConfirmation('2026-10-21', '2026-10-22')).toBe('10/21(수) 일기에 적어뒀어.');
  });

  it('작년 날짜는 연도를 붙인다', () => {
    expect(formatDatedConfirmation('2026-12-10', '2027-01-05')).toBe(
      '2026년 12/10(목) 일기에 적어뒀어.',
    );
  });
});

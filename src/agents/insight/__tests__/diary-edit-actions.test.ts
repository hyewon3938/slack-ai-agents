import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock('../../../shared/llm.js', () => ({ createDiaryMetaLLMClient: vi.fn() }));
vi.mock('../../../cron/diary-meta-extract.js', () => ({ extractAndPersistForUser: vi.fn() }));
vi.mock('../../../shared/user-resolver.js', () => ({ resolveUserId: vi.fn(), DEFAULT_USER_ID: 1 }));

const { validateDiaryEditDate, formatDiaryEditConfirmation } =
  await import('../diary-edit-actions.js');

type Saved = Parameters<typeof formatDiaryEditConfirmation>[0];

const TODAY = '2026-10-22';

describe('validateDiaryEditDate', () => {
  it('오늘과 지난 날짜는 통과', () => {
    expect(validateDiaryEditDate('2026-10-22', TODAY)).toBeNull();
    expect(validateDiaryEditDate('2025-12-31', TODAY)).toBeNull();
  });

  it('미래 날짜와 빈 값은 오류', () => {
    expect(validateDiaryEditDate('2026-10-23', TODAY)).not.toBeNull();
    expect(validateDiaryEditDate(null, TODAY)).not.toBeNull();
    expect(validateDiaryEditDate('10/21', TODAY)).not.toBeNull();
  });
});

describe('formatDiaryEditConfirmation', () => {
  const entry = { id: 3, date: '2026-10-18', content: 'x' };

  it('동작마다 확인 문구', () => {
    const saved = (action: Saved['action']): Saved => ({
      kind: 'saved',
      action,
      entry,
      changedDates: [],
    });
    expect(formatDiaryEditConfirmation(saved('updated'), '2026-10-20', TODAY)).toBe('고쳐뒀어.');
    expect(formatDiaryEditConfirmation(saved('moved'), '2026-10-20', TODAY)).toBe(
      '10/18(일) 일기로 옮겼어.',
    );
    expect(formatDiaryEditConfirmation(saved('merged'), '2026-10-20', TODAY)).toBe(
      '10/18(일) 일기 뒤에 이어 붙였어.',
    );
  });

  it('삭제는 원래 날짜로, 작년이면 연도를 붙인다', () => {
    const deleted: Saved = {
      kind: 'saved',
      action: 'deleted',
      entry: null,
      changedDates: ['2025-12-25'],
    };
    expect(formatDiaryEditConfirmation(deleted, '2025-12-25', TODAY)).toBe(
      '2025년 12/25(목) 일기를 지웠어.',
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SayFn } from '@slack/bolt';

// 운세 fast path — 월/세/대운은 기간 해석 경로, 일운은 fortune_analyses 경로.
// 약속된 명령어(+정해진 접두·접미)만 받고 자유 문장은 false로 LLM에 넘긴다.

const mockQueryOne = vi.fn();
const mockLoadInterpretation = vi.fn();
const mockLoadLedger = vi.fn();

vi.mock('../../../shared/db.js', () => ({
  queryOne: (...a: unknown[]): unknown => mockQueryOne(...a),
}));
vi.mock('../../../shared/period/interpretation-store.js', () => ({
  loadLatestInterpretation: (...a: unknown[]): unknown => mockLoadInterpretation(...a),
}));
vi.mock('../../../shared/period/forecast-ledger.js', () => ({
  loadLedger: (...a: unknown[]): unknown => mockLoadLedger(...a),
}));
vi.mock('../../../shared/period/interpretation-render.js', () => ({
  renderInterpretationBlocks: vi.fn(() => []),
}));

const { tryPeriodInterpretationFastPath, tryFortuneFastPath } =
  await import('../fortune-fast-path.js');

const USER = 3;
let said: unknown[] = [];
const say = vi.fn(async (msg: unknown) => {
  said.push(msg);
  return { ok: true };
}) as unknown as SayFn;

beforeEach(() => {
  said = [];
  mockQueryOne.mockReset();
  mockLoadInterpretation.mockReset();
  mockLoadLedger.mockReset();
  mockQueryOne.mockResolvedValue(null);
  mockLoadInterpretation.mockResolvedValue(null);
  mockLoadLedger.mockResolvedValue({ periodType: 'wolun', scored: [], forecasts: [] });
  // KST 2026-10-22 01:00 (UTC로는 아직 10-21) — 서버 TZ와 무관하게 KST 날짜를 쓰는지 함께 확인
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T16:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 기간 해석(월/세/대운) ──────────────────────────────

describe('tryPeriodInterpretationFastPath — 매칭', () => {
  it.each([
    ['월운', 'wolun'],
    ['이번 달 월운', 'wolun'],
    ['이번달 월운 보여줘', 'wolun'],
    ['세운', 'seun'],
    ['올해 세운 알려줘', 'seun'],
    ['대운', 'daeun'],
    ['내 대운 뭐야?', 'daeun'],
  ])('"%s" → %s 해석을 조회한다', async (text, periodType) => {
    expect(await tryPeriodInterpretationFastPath(text, say, USER)).toBe(true);
    expect(mockLoadInterpretation).toHaveBeenCalledWith(USER, periodType);
  });

  it.each(['월운 어때', '이번 달 월운이 궁금해', '다음 달 월운', '세운이랑 대운 비교해줘', '일운'])(
    '자유 문장·다른 명령 "%s"는 false로 넘기고 조회하지 않는다',
    async (text) => {
      expect(await tryPeriodInterpretationFastPath(text, say, USER)).toBe(false);
      expect(mockLoadInterpretation).not.toHaveBeenCalled();
      expect(said).toEqual([]);
    },
  );
});

describe('tryPeriodInterpretationFastPath — 응답', () => {
  const record = { pillar: '병인' };

  it('해석이 없으면 기간별 다음 생성 시점을 안내한다', async () => {
    await tryPeriodInterpretationFastPath('월운', say, USER);
    await tryPeriodInterpretationFastPath('세운', say, USER);
    await tryPeriodInterpretationFastPath('대운', say, USER);
    expect(said).toEqual([
      '아직 이번 절기달 운세 해석이 없어. 다음 절기 전환 때 만들어서 보내줄게.',
      '아직 올해 운세(입춘 기준) 해석이 없어. 다음 입춘 때 만들어서 보내줄게.',
      '아직 대운 흐름 해석이 없어. 다음 대운 전환 때 만들어서 보내줄게.',
    ]);
  });

  it('월운·세운은 예측 장부를 함께 불러오고 대운은 부르지 않는다', async () => {
    mockLoadInterpretation.mockResolvedValue(record);
    await tryPeriodInterpretationFastPath('월운', say, USER);
    await tryPeriodInterpretationFastPath('세운', say, USER);
    expect(mockLoadLedger.mock.calls).toEqual([
      [USER, 'wolun'],
      [USER, 'seun'],
    ]);

    mockLoadLedger.mockClear();
    await tryPeriodInterpretationFastPath('대운', say, USER);
    expect(mockLoadLedger).not.toHaveBeenCalled();
  });

  it('조회 오류여도 true를 돌려 LLM으로 넘기지 않고 오류 안내를 보낸다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockLoadInterpretation.mockRejectedValue(new Error('down'));
    expect(await tryPeriodInterpretationFastPath('세운', say, USER)).toBe(true);
    expect(said).toEqual(['올해 운세(입춘 기준) 조회 중 오류가 발생했어.']);
  });
});

// ─── 일운 ───────────────────────────────────────────────

describe('tryFortuneFastPath', () => {
  it.each(['일운', '오늘 일운', '오늘일운 보여줘', '일운 뭐야?'])(
    '"%s"는 KST 오늘 날짜로 조회한다',
    async (text) => {
      expect(await tryFortuneFastPath(text, say, USER)).toBe(true);
      expect(mockQueryOne.mock.calls[0][1]).toEqual([USER, '2026-10-22']);
    },
  );

  it('"내일 일운"은 KST 내일 날짜로 조회한다', async () => {
    expect(await tryFortuneFastPath('내일 일운 알려줘', say, USER)).toBe(true);
    expect(mockQueryOne.mock.calls[0][1]).toEqual([USER, '2026-10-23']);
  });

  it.each(['월운', '세운', '대운', '일운 좀 봐줘', '오늘 일운 어때', '어제 일운'])(
    '"%s"는 false로 넘기고 조회하지 않는다 (월/세/대운은 기간 해석 경로 전담)',
    async (text) => {
      expect(await tryFortuneFastPath(text, say, USER)).toBe(false);
      expect(mockQueryOne).not.toHaveBeenCalled();
    },
  );

  it('분석이 없으면 준비 안 됨 안내', async () => {
    await tryFortuneFastPath('내일 일운', say, USER);
    expect(said).toEqual(['아직 내일 일운 분석이 준비되지 않았어.']);
  });
});

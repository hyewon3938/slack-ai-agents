import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  RoutineRecordRow,
  ScheduleRow,
  SleepRecordRow,
  SleepEventRow,
} from '../../../shared/life-queries.js';

// ── DB mock ──
vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  connectDB: vi.fn(),
}));

// ── life-queries mock ──
const mockQueryTodayRecords = vi.fn<() => Promise<RoutineRecordRow[]>>(async () => []);
const mockQueryTodaySchedules = vi.fn<() => Promise<ScheduleRow[]>>(async () => []);
const mockQuerySleepForHome = vi.fn<() => Promise<SleepRecordRow[]>>(async () => []);
const mockQuerySleepEventsForHome = vi.fn<() => Promise<SleepEventRow[]>>(async () => []);

vi.mock('../../../shared/life-queries.js', () => ({
  queryTodayRecords: () => mockQueryTodayRecords(),
  queryTodaySchedules: () => mockQueryTodaySchedules(),
  querySleepForHome: () => mockQuerySleepForHome(),
  querySleepEventsForHome: () => mockQuerySleepEventsForHome(),
  frequencyBadge: vi.fn(() => ''),
}));

// ── life-cron mock ──
const mockCreateTodayRecords = vi.fn(async () => 0);
vi.mock('../../../cron/life-cron.js', () => ({
  createTodayRecords: () => mockCreateTodayRecords(),
}));

import { publishHomeView } from '../home.js';

// ── 블록에서 텍스트 추출 헬퍼 ──
interface BlockWithText {
  type: string;
  text?: { text: string };
  elements?: Array<{ text: string }>;
}

const extractSectionTexts = (blocks: BlockWithText[]): string[] =>
  blocks.filter((b) => b.type === 'section' && b.text?.text).map((b) => b.text!.text);

describe('publishHomeView', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockPublish = vi.fn(async () => ({}) as any);
  const mockClient = {
    views: { publish: mockPublish },
  } as unknown as Parameters<typeof publishHomeView>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getBlocks = (): BlockWithText[] => {
    const call = mockPublish.mock.calls[0] as unknown[];
    const arg = call[0] as { view: { blocks: BlockWithText[] } };
    return arg.view.blocks;
  };

  it('views.publish를 호출한다', async () => {
    await publishHomeView(mockClient, 'U123');

    expect(mockPublish).toHaveBeenCalledOnce();
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'U123',
        view: expect.objectContaining({ type: 'home' }),
      }),
    );
  });

  it('오늘 루틴 레코드를 생성한다', async () => {
    await publishHomeView(mockClient, 'U123');

    expect(mockCreateTodayRecords).toHaveBeenCalledOnce();
  });

  it('데이터가 없으면 빈 상태 메시지를 표시한다', async () => {
    await publishHomeView(mockClient, 'U123');

    const texts = extractSectionTexts(getBlocks());

    expect(texts.some((t) => t.includes('일정 없음'))).toBe(true);
    expect(texts.some((t) => t.includes('루틴 없음'))).toBe(true);
    expect(texts.some((t) => t.includes('기록 없음'))).toBe(true);
  });

  it('일정이 있으면 일정 블록을 포함한다', async () => {
    mockQueryTodaySchedules.mockResolvedValueOnce([
      {
        id: 1,
        title: '미팅',
        date: '2025-03-08',
        end_date: null,
        status: 'todo',
        category: '업무',
        memo: null,
        important: false,
      },
    ]);

    await publishHomeView(mockClient, 'U123');

    const texts = extractSectionTexts(getBlocks());
    expect(texts.some((t) => t.includes('미팅'))).toBe(true);
    expect(texts.some((t) => t.includes('일정 없음'))).toBe(false);
  });

  it('루틴이 있으면 루틴 블록을 포함한다', async () => {
    mockQueryTodayRecords.mockResolvedValueOnce([
      {
        id: 1,
        template_id: 1,
        date: '2025-03-08',
        completed: false,
        completed_at: null,
        memo: null,
        name: '스트레칭',
        time_slot: '아침',
        frequency: '매일',
      },
    ]);

    await publishHomeView(mockClient, 'U123');

    const texts = extractSectionTexts(getBlocks());
    expect(texts.some((t) => t.includes('스트레칭'))).toBe(true);
    expect(texts.some((t) => t.includes('루틴 없음'))).toBe(false);
  });

  it('밤잠 + 낮잠 기록을 표시한다', async () => {
    mockQuerySleepForHome.mockResolvedValueOnce([
      {
        id: 1,
        date: '2025-03-07',
        bedtime: '23:30',
        wake_time: '07:00',
        duration_minutes: 450,
        sleep_type: 'night',
        memo: null,
      },
      {
        id: 2,
        date: '2025-03-08',
        bedtime: '14:00',
        wake_time: '15:00',
        duration_minutes: 60,
        sleep_type: 'nap',
        memo: null,
      },
    ]);

    await publishHomeView(mockClient, 'U123');

    const texts = extractSectionTexts(getBlocks());
    const sleepText = texts.find((t) => t.includes('수면'));
    expect(sleepText).toContain('밤잠');
    expect(sleepText).toContain('23:30');
    expect(sleepText).toContain('낮잠');
    expect(sleepText).toContain('14:00');
    expect(texts.some((t) => t.includes('기록 없음'))).toBe(false);
  });

  it('수면 메모와 중간 기상 이벤트를 표시한다', async () => {
    mockQuerySleepForHome.mockResolvedValueOnce([
      {
        id: 1,
        date: '2025-03-07',
        bedtime: '23:30',
        wake_time: '07:00',
        duration_minutes: 450,
        sleep_type: 'night',
        memo: '뒤척임',
      },
    ]);
    mockQuerySleepEventsForHome.mockResolvedValueOnce([
      { id: 1, date: '2025-03-07', event_time: '03:00', memo: '화장실' },
    ]);

    await publishHomeView(mockClient, 'U123');

    const blocks = getBlocks();
    const contextTexts = blocks
      .filter((b) => b.type === 'context')
      .map((b) => b.elements?.[0]?.text ?? '');

    expect(contextTexts.some((t) => t.includes('뒤척임'))).toBe(true);
    expect(contextTexts.some((t) => t.includes('중간 기상') && t.includes('03:00'))).toBe(true);
  });

  it('헤더에 대시보드를 포함한다', async () => {
    await publishHomeView(mockClient, 'U123');

    const blocks = getBlocks();
    const headers = blocks.filter((b) => b.type === 'header');

    expect(headers).toHaveLength(1);
    expect(headers[0]!.text!.text).toContain('대시보드');
  });

  it('마지막 업데이트 시각을 포함한다', async () => {
    await publishHomeView(mockClient, 'U123');

    const blocks = getBlocks();
    const contexts = blocks.filter((b) => b.type === 'context');
    const lastContext = contexts[contexts.length - 1]!;

    expect(lastContext.elements![0]!.text).toMatch(/마지막 업데이트: \d{2}:\d{2}/);
  });
});

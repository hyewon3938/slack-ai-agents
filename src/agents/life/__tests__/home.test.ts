import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RoutineRecordRow, ScheduleRow, SleepRecordRow } from '../../../shared/life-queries.js';

// ── DB mock ──
vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  connectDB: vi.fn(),
}));

// ── life-queries mock ──
const mockQueryTodayRecords = vi.fn<() => Promise<RoutineRecordRow[]>>(async () => []);
const mockQueryTodaySchedules = vi.fn<() => Promise<ScheduleRow[]>>(async () => []);
const mockQueryLatestSleep = vi.fn<() => Promise<SleepRecordRow | null>>(async () => null);

vi.mock('../../../shared/life-queries.js', () => ({
  queryTodayRecords: (...args: unknown[]) => mockQueryTodayRecords(),
  queryTodaySchedules: (...args: unknown[]) => mockQueryTodaySchedules(),
  queryLatestSleep: () => mockQueryLatestSleep(),
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
  blocks
    .filter((b) => b.type === 'section' && b.text?.text)
    .map((b) => b.text!.text);

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
        id: 1, title: '미팅', date: '2025-03-08', end_date: null,
        status: 'todo', category: '업무', memo: null, important: false,
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
        id: 1, template_id: 1, date: '2025-03-08', completed: false,
        name: '스트레칭', time_slot: '아침', frequency: '매일',
      },
    ]);

    await publishHomeView(mockClient, 'U123');

    const texts = extractSectionTexts(getBlocks());
    expect(texts.some((t) => t.includes('스트레칭'))).toBe(true);
    expect(texts.some((t) => t.includes('루틴 없음'))).toBe(false);
  });

  it('수면 기록이 있으면 수면 블록을 포함한다', async () => {
    mockQueryLatestSleep.mockResolvedValueOnce({
      id: 1, date: '2025-03-07', bedtime: '23:30', wake_time: '07:00',
      duration_minutes: 450, sleep_type: 'night', memo: null,
    });

    await publishHomeView(mockClient, 'U123');

    const texts = extractSectionTexts(getBlocks());
    expect(texts.some((t) => t.includes('23:30'))).toBe(true);
    expect(texts.some((t) => t.includes('07:00'))).toBe(true);
    expect(texts.some((t) => t.includes('기록 없음'))).toBe(false);
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

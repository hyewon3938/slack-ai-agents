import { describe, it, expect, vi, beforeEach } from 'vitest';

// DB 모킹 — 빈 결과 반환 (실제 DB 없이 프롬프트 구조만 검증)
vi.mock('../../../shared/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

// kst 모킹 — 결정론적 날짜
vi.mock('../../../shared/kst.js', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/kst.js')>(
    '../../../shared/kst.js',
  );
  return {
    ...actual,
    getTodayISO: () => '2026-04-11',
    getTodayString: () => '2026-04-11 (토)',
  };
});

const { buildInsightSystemPrompt } = await import('../prompt.js');

describe('buildInsightSystemPrompt — 일주 앵커 가드레일', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('상단에 "오늘 일주:" 앵커를 포함한다', async () => {
    const prompt = await buildInsightSystemPrompt(1);
    // 2026-04-11 = 을묘(乙卯) — getDayPillar로 계산된 실제 값
    expect(prompt).toMatch(/오늘 일주: 을묘\(乙卯\)/);
    expect(prompt).toMatch(/절대 불변/);
  });

  it('"상단 앵커만 사용" 가드레일 문구를 포함한다', async () => {
    const prompt = await buildInsightSystemPrompt(1);
    expect(prompt).toMatch(/오늘 일주는 프롬프트 상단.*박힌 값만 사용/);
    expect(prompt).toMatch(/saju_patterns 설명.*일주와 무관/);
    expect(prompt).toMatch(/역산/);
  });

  it('일주 앵커가 프롬프트 초반(상위 30%)에 위치한다', async () => {
    const prompt = await buildInsightSystemPrompt(1);
    const anchorIdx = prompt.indexOf('오늘 일주:');
    expect(anchorIdx).toBeGreaterThan(-1);
    expect(anchorIdx / prompt.length).toBeLessThan(0.3);
  });
});

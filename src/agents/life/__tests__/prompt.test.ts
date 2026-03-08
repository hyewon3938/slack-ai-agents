import { describe, it, expect, vi } from 'vitest';
import { getTodayString, getTodayISO } from '../../../shared/kst.js';
import { buildLifeSystemPrompt } from '../prompt.js';

vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(async () => ({ rows: [] })),
}));

describe('getTodayString', () => {
  it('YYYY-MM-DD (요일) 형식을 반환한다', () => {
    const result = getTodayString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \([일월화수목금토]\)$/);
  });
});

describe('getTodayISO', () => {
  it('YYYY-MM-DD 형식을 반환한다', () => {
    const result = getTodayISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('buildLifeSystemPrompt', () => {
  it('캐릭터 프롬프트를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123');
    expect(prompt).toContain('잔소리꾼');
    expect(prompt).toContain('친한 친구');
  });

  it('오늘 날짜를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123');
    expect(prompt).toMatch(/오늘: \d{4}-\d{2}-\d{2}/);
  });

  it('DB 스키마 정보를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123');
    expect(prompt).toContain('schedules');
    expect(prompt).toContain('routine_templates');
    expect(prompt).toContain('routine_records');
    expect(prompt).toContain('sleep_records');
    expect(prompt).toContain('custom_instructions');
    expect(prompt).toContain('source(user/auto)');
    expect(prompt).toContain('active(boolean)');
  });

  it('대화 방식과 데이터 규칙을 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123');
    expect(prompt).toContain('자연스럽게 대화해');
    expect(prompt).toContain('도구로 조회해');
    expect(prompt).toContain('크로스 분석');
    expect(prompt).toContain('EXTRACT(DOW FROM date)');
  });

  it('일정 표시 포맷을 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123');
    expect(prompt).toContain('카테고리별로 그룹화');
    expect(prompt).toContain('►');
    expect(prompt).toContain('★');
  });

  it('커스텀 지시사항 관리 규칙을 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123');
    expect(prompt).toContain('custom_instructions에 INSERT');
    expect(prompt).toContain('지시사항 보여줘');
    expect(prompt).toContain("source = 'user'");
    expect(prompt).toContain("source = 'auto'");
    expect(prompt).toContain('active = false');
    expect(prompt).toContain('통합 규칙');
  });

  it('변경 후 응답 규칙과 백로그 관리를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123');
    expect(prompt).toContain('전체 일정 목록을 조회');
    expect(prompt).toContain('백로그');
    expect(prompt).toContain('date IS NULL');
  });

  it('140줄 이내의 간결한 프롬프트', async () => {
    const prompt = await buildLifeSystemPrompt('C123');
    const lineCount = prompt.split('\n').length;
    expect(lineCount).toBeLessThan(140);
  });
});

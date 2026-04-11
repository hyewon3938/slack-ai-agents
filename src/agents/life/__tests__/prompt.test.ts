import { describe, it, expect, vi } from 'vitest';
import { getTodayString, getTodayISO, getWeekReference } from '../../../shared/kst.js';
import { buildLifeSystemPrompt } from '../prompt.js';

vi.mock('../../../shared/db.js', () => ({
  query: vi.fn(async () => ({ rows: [] })),
}));

vi.mock('../../../shared/life-context.js', () => ({
  buildLifeContext: vi.fn(async () => '\n\n## 현재 생활 맥락\n수면: 테스트 맥락'),
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

describe('getWeekReference', () => {
  it('이번 주와 다음 주 날짜-요일 참조표를 반환한다', () => {
    const result = getWeekReference();
    expect(result).toContain('지난 주:');
    expect(result).toContain('이번 주:');
    expect(result).toContain('다음 주:');
    // 각 주에 7개 날짜 포함
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toMatch(/[일월화수목금토]/);
    }
  });
});

describe('buildLifeSystemPrompt', () => {
  it('캐릭터 프롬프트를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    expect(prompt).toContain('잔소리꾼');
    expect(prompt).toContain('친한 친구');
  });

  it('오늘 날짜와 주간 참조표를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    expect(prompt).toMatch(/오늘: \d{4}-\d{2}-\d{2}/);
    expect(prompt).toContain('이번 주:');
    expect(prompt).toContain('다음 주:');
  });

  it('DB 스키마 정보를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    expect(prompt).toContain('schedules');
    expect(prompt).toContain('routine_templates');
    expect(prompt).toContain('routine_records');
    expect(prompt).toContain('sleep_records');
    expect(prompt).toContain('custom_instructions');
    expect(prompt).toContain('source(user/auto)');
    expect(prompt).toContain('active');
  });

  it('일정 조회 3대 필수 규칙을 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    // 기간 일정 WHERE 패턴
    expect(prompt).toContain('date <= ');
    expect(prompt).toContain('end_date >= ');
    // 요일 SQL
    expect(prompt).toContain('EXTRACT(DOW FROM date)');
    // 정렬 ORDER BY
    expect(prompt).toContain("WHEN 'done' THEN 1");
    expect(prompt).toContain("WHEN 'in-progress' THEN 2");
    expect(prompt).toContain("WHEN 'todo' THEN 3");
  });

  it('일정 표시 포맷을 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    expect(prompt).toContain('카테고리별로 그룹화');
    expect(prompt).toContain('►');
    expect(prompt).toContain('★');
  });

  it('커스텀 지시사항 관리 규칙을 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    expect(prompt).toContain("source='user'");
    expect(prompt).toContain("source='auto'");
    expect(prompt).toContain('커스텀 지시사항');
  });

  it('변경 후 응답 규칙과 백로그 관리를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    expect(prompt).toContain('3대 필수 규칙으로 조회');
    expect(prompt).toContain('백로그');
    expect(prompt).toContain('date IS NULL');
  });

  it('생활 맥락과 잔소리 가이드를 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    expect(prompt).toContain('현재 생활 맥락');
    expect(prompt).toContain('잔소리 가이드');
    expect(prompt).toContain('수면 부족');
    expect(prompt).toContain('백로그');
  });

  it('수면 레코드 변경 규칙을 포함한다', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    // UPDATE/DELETE sleep_type 필터 규칙
    expect(prompt).toContain('sleep_type 필터');
    // INSERT 전 중복 확인 규칙
    expect(prompt).toContain('INSERT 전');
    // 날짜 이동 UPDATE 규칙
    expect(prompt).toContain('날짜 이동');
    // 사용자 언급 없는 INSERT 금지
    expect(prompt).toContain('직접 언급하지 않은');
  });

  it('220줄 이내의 간결한 프롬프트', async () => {
    const prompt = await buildLifeSystemPrompt('C123', 1);
    const lineCount = prompt.split('\n').length;
    expect(lineCount).toBeLessThan(220);
  });
});

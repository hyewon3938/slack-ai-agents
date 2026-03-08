import { describe, it, expect } from 'vitest';
import { getTodayString, buildLifeSystemPrompt } from '../prompt.js';
import { ChatHistory } from '../../../shared/chat-history.js';

describe('getTodayString', () => {
  it('YYYY-MM-DD (요일) 형식을 반환한다', () => {
    const result = getTodayString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \([일월화수목금토]\)$/);
  });
});

describe('buildLifeSystemPrompt', () => {
  it('캐릭터 프롬프트를 포함한다', () => {
    const history = new ChatHistory();
    const prompt = buildLifeSystemPrompt(history, 'C123');
    expect(prompt).toContain('잔소리꾼');
    expect(prompt).toContain('친한 친구');
  });

  it('오늘 날짜를 포함한다', () => {
    const history = new ChatHistory();
    const prompt = buildLifeSystemPrompt(history, 'C123');
    expect(prompt).toMatch(/오늘: \d{4}-\d{2}-\d{2}/);
  });

  it('DB 스키마 정보를 포함한다', () => {
    const history = new ChatHistory();
    const prompt = buildLifeSystemPrompt(history, 'C123');
    expect(prompt).toContain('schedules');
    expect(prompt).toContain('routine_templates');
    expect(prompt).toContain('routine_records');
  });

  it('규칙을 포함한다', () => {
    const history = new ChatHistory();
    const prompt = buildLifeSystemPrompt(history, 'C123');
    expect(prompt).toContain('반드시 도구를 사용해');
    expect(prompt).toContain('크로스 분석');
  });

  it('대화 맥락이 있으면 포함한다', () => {
    const history = new ChatHistory();
    history.add('C123', '오늘 일정 뭐야?', '오늘은 회의가 있어.');
    const prompt = buildLifeSystemPrompt(history, 'C123');
    expect(prompt).toContain('[최근 대화]');
    expect(prompt).toContain('오늘 일정 뭐야?');
  });

  it('대화 맥락이 없으면 [최근 대화] 없음', () => {
    const history = new ChatHistory();
    const prompt = buildLifeSystemPrompt(history, 'C123');
    expect(prompt).not.toContain('[최근 대화]');
  });

  it('30줄 이내의 간결한 프롬프트', () => {
    const history = new ChatHistory();
    const prompt = buildLifeSystemPrompt(history, 'C123');
    const lineCount = prompt.split('\n').length;
    // 캐릭터 프롬프트 포함해도 30줄 내외
    expect(lineCount).toBeLessThan(35);
  });
});

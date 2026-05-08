import { describe, it, expect } from 'vitest';
import { formatFortuneText } from '../fortune-format.js';

describe('formatFortuneText', () => {
  it('summary + analysis + advice를 모두 결합한다', () => {
    const result = formatFortuneText({
      summary: '오늘의 핵심 키워드',
      analysis: '본문 단락 1.\n\n본문 단락 2.',
      advice: '명리학적 격언',
    });
    expect(result).toBe('*오늘의 핵심 키워드*\n\n본문 단락 1.\n\n본문 단락 2.\n\n_명리학적 격언_');
  });

  it('summary가 null이면 생략하고 analysis + advice만 결합한다', () => {
    const result = formatFortuneText({
      summary: null,
      analysis: '본문',
      advice: '격언',
    });
    expect(result).toBe('본문\n\n_격언_');
  });

  it('advice가 null이면 생략하고 summary + analysis만 결합한다', () => {
    const result = formatFortuneText({
      summary: '요약',
      analysis: '본문',
      advice: null,
    });
    expect(result).toBe('*요약*\n\n본문');
  });

  it('summary와 advice가 모두 null이면 analysis만 반환한다', () => {
    const result = formatFortuneText({
      summary: null,
      analysis: '본문',
      advice: null,
    });
    expect(result).toBe('본문');
  });

  it('빈 문자열 summary/advice는 truthy 체크에서 걸러져 생략된다', () => {
    const result = formatFortuneText({
      summary: '',
      analysis: '본문',
      advice: '',
    });
    expect(result).toBe('본문');
  });

  it('단락은 빈 줄(\\n\\n)로 구분된다', () => {
    const result = formatFortuneText({
      summary: 'A',
      analysis: 'B',
      advice: 'C',
    });
    expect(result.split('\n\n')).toEqual(['*A*', 'B', '_C_']);
  });
});

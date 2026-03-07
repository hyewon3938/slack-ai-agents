import { describe, it, expect } from 'vitest';
import { ChatHistory } from '../chat-history.js';

describe('ChatHistory', () => {
  it('대화 쌍을 추가하고 컨텍스트를 생성한다', () => {
    const h = new ChatHistory();
    h.add('ch1', '오늘 일정 보여줘', '오늘 일정이야. 미팅, 보고서.');

    const ctx = h.toContext('ch1');
    expect(ctx).toContain('사용자: 오늘 일정 보여줘');
    expect(ctx).toContain('잔소리꾼: 오늘 일정이야. 미팅, 보고서.');
    expect(ctx).toContain('[최근 대화]');
  });

  it('히스토리가 없으면 빈 문자열을 반환한다', () => {
    const h = new ChatHistory();
    expect(h.toContext('ch1')).toBe('');
  });

  it('채널별로 독립적으로 저장한다', () => {
    const h = new ChatHistory();
    h.add('ch1', '일정 관련', '일정 응답');
    h.add('ch2', '루틴 관련', '루틴 응답');

    expect(h.toContext('ch1')).toContain('일정 관련');
    expect(h.toContext('ch1')).not.toContain('루틴 관련');
    expect(h.toContext('ch2')).toContain('루틴 관련');
    expect(h.toContext('ch2')).not.toContain('일정 관련');
  });

  it('최대 쌍 수를 초과하면 오래된 것부터 제거한다', () => {
    const h = new ChatHistory(2); // 최대 2쌍

    h.add('ch1', '메시지1', '응답1');
    h.add('ch1', '메시지2', '응답2');
    h.add('ch1', '메시지3', '응답3');

    const ctx = h.toContext('ch1');
    expect(ctx).not.toContain('메시지1');
    expect(ctx).toContain('메시지2');
    expect(ctx).toContain('메시지3');
  });

  it('size가 쌍 수를 반환한다', () => {
    const h = new ChatHistory();
    expect(h.size('ch1')).toBe(0);

    h.add('ch1', 'a', 'b');
    expect(h.size('ch1')).toBe(1);

    h.add('ch1', 'c', 'd');
    expect(h.size('ch1')).toBe(2);
  });

  it('clear로 채널 히스토리를 초기화한다', () => {
    const h = new ChatHistory();
    h.add('ch1', 'a', 'b');
    h.add('ch2', 'c', 'd');

    h.clear('ch1');
    expect(h.toContext('ch1')).toBe('');
    expect(h.toContext('ch2')).toContain('c'); // ch2는 유지
  });

  it('슬라이딩 윈도우가 정확히 maxPairs개를 유지한다', () => {
    const h = new ChatHistory(3);
    for (let i = 1; i <= 5; i++) {
      h.add('ch1', `msg${i}`, `reply${i}`);
    }

    expect(h.size('ch1')).toBe(3);
    const ctx = h.toContext('ch1');
    expect(ctx).not.toContain('msg1');
    expect(ctx).not.toContain('msg2');
    expect(ctx).toContain('msg3');
    expect(ctx).toContain('msg4');
    expect(ctx).toContain('msg5');
  });

  it('컨텍스트가 올바른 포맷으로 생성된다', () => {
    const h = new ChatHistory();
    h.add('ch1', '오늘 뭐 있어', '미팅이 있어.');
    h.add('ch1', '미팅 완료해줘', '미팅 완료 처리했어.');

    const ctx = h.toContext('ch1');
    const expected = [
      '',
      '',
      '[최근 대화]',
      '사용자: 오늘 뭐 있어',
      '잔소리꾼: 미팅이 있어.',
      '사용자: 미팅 완료해줘',
      '잔소리꾼: 미팅 완료 처리했어.',
    ].join('\n');
    expect(ctx).toBe(expected);
  });
});

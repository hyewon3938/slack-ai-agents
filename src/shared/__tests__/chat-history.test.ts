import { describe, it, expect } from 'vitest';
import { ChatHistory } from '../chat-history.js';

describe('ChatHistory', () => {
  it('대화 쌍을 추가하고 메시지 배열을 반환한다', () => {
    const h = new ChatHistory();
    h.add('ch1', '오늘 일정 보여줘', '오늘 일정이야. 미팅, 보고서.');

    const msgs = h.toMessages('ch1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'user', content: '오늘 일정 보여줘' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: '오늘 일정이야. 미팅, 보고서.' });
  });

  it('히스토리가 없으면 빈 배열을 반환한다', () => {
    const h = new ChatHistory();
    expect(h.toMessages('ch1')).toEqual([]);
  });

  it('채널별로 독립적으로 저장한다', () => {
    const h = new ChatHistory();
    h.add('ch1', '일정 관련', '일정 응답');
    h.add('ch2', '루틴 관련', '루틴 응답');

    const ch1 = h.toMessages('ch1');
    const ch2 = h.toMessages('ch2');
    expect(ch1).toHaveLength(2);
    expect(ch2).toHaveLength(2);
    expect(ch1[0].content).toBe('일정 관련');
    expect(ch2[0].content).toBe('루틴 관련');
  });

  it('최대 쌍 수를 초과하면 오래된 것부터 제거한다', () => {
    const h = new ChatHistory({ maxPairs: 2 }); // 최대 2쌍

    h.add('ch1', '메시지1', '응답1');
    h.add('ch1', '메시지2', '응답2');
    h.add('ch1', '메시지3', '응답3');

    const msgs = h.toMessages('ch1');
    expect(msgs).toHaveLength(4); // 2쌍 = 4엔트리
    expect(msgs[0].content).toBe('메시지2');
    expect(msgs[2].content).toBe('메시지3');
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
    expect(h.toMessages('ch1')).toEqual([]);
    expect(h.toMessages('ch2')).toHaveLength(2); // ch2는 유지
  });

  it('슬라이딩 윈도우가 정확히 maxPairs개를 유지한다', () => {
    const h = new ChatHistory({ maxPairs: 3 });
    for (let i = 1; i <= 5; i++) {
      h.add('ch1', `msg${i}`, `reply${i}`);
    }

    expect(h.size('ch1')).toBe(3);
    const msgs = h.toMessages('ch1');
    expect(msgs).toHaveLength(6); // 3쌍 = 6엔트리
    expect(msgs[0].content).toBe('msg3');
    expect(msgs[2].content).toBe('msg4');
    expect(msgs[4].content).toBe('msg5');
  });

  it('메시지가 maxChars를 초과하면 앞부분을 잘라낸다', () => {
    const h = new ChatHistory({ maxUserChars: 10, maxAssistantChars: 8 });
    h.add('ch1', '가나다라마바사아자차카', '12345678901234');

    const msgs = h.toMessages('ch1');
    // user: 11자 → 10자 (…+ 뒤 9자)
    expect(msgs[0].content).toBe('…다라마바사아자차카');
    // assistant: 14자 → 8자 (…+ 뒤 7자)
    expect(msgs[1].content).toBe('…8901234');
  });

  it('role별 제한이 독립적으로 적용된다', () => {
    const h = new ChatHistory({ maxUserChars: 5, maxAssistantChars: 100 });
    h.add('ch1', '짧은 메시지', '이건 긴 응답이지만 제한에 안 걸림');

    const msgs = h.toMessages('ch1');
    expect(msgs[0].content.length).toBe(5); // user 잘림
    expect(msgs[1].content).toBe('이건 긴 응답이지만 제한에 안 걸림'); // assistant 유지
  });

  it('toMessages가 올바른 role을 반환한다', () => {
    const h = new ChatHistory();
    h.add('ch1', '오늘 뭐 있어', '미팅이 있어.');
    h.add('ch1', '미팅 완료해줘', '미팅 완료 처리했어.');

    const msgs = h.toMessages('ch1');
    expect(msgs).toEqual([
      { role: 'user', content: '오늘 뭐 있어' },
      { role: 'assistant', content: '미팅이 있어.' },
      { role: 'user', content: '미팅 완료해줘' },
      { role: 'assistant', content: '미팅 완료 처리했어.' },
    ]);
  });
});

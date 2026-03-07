/** 채널별 대화 맥락 저장 (인메모리 슬라이딩 윈도우) */

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
}

const DEFAULT_MAX_PAIRS = 10;

export class ChatHistory {
  private store = new Map<string, ChatEntry[]>();
  private maxPairs: number;

  constructor(maxPairs = DEFAULT_MAX_PAIRS) {
    this.maxPairs = maxPairs;
  }

  /** 대화 쌍 추가 (user + assistant) */
  add(channelId: string, userMsg: string, assistantMsg: string): void {
    const entries = this.store.get(channelId) ?? [];
    entries.push(
      { role: 'user', content: userMsg },
      { role: 'assistant', content: assistantMsg },
    );

    // 최대 N쌍 (2*N 엔트리) 유지
    const maxEntries = this.maxPairs * 2;
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }

    this.store.set(channelId, entries);
  }

  /** 시스템 프롬프트에 주입할 대화 맥락 문자열 (없으면 빈 문자열) */
  toContext(channelId: string): string {
    const entries = this.store.get(channelId);
    if (!entries || entries.length === 0) return '';

    const lines = entries.map((e) =>
      e.role === 'user' ? `사용자: ${e.content}` : `잔소리꾼: ${e.content}`,
    );
    return `\n\n[최근 대화]\n${lines.join('\n')}`;
  }

  /** 히스토리 크기 (쌍 수) */
  size(channelId: string): number {
    const entries = this.store.get(channelId);
    return entries ? Math.floor(entries.length / 2) : 0;
  }

  /** 채널 히스토리 초기화 */
  clear(channelId: string): void {
    this.store.delete(channelId);
  }
}

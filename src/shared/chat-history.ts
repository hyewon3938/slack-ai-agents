/** 채널별 대화 맥락 저장 (인메모리 슬라이딩 윈도우) */

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatHistoryOptions {
  maxPairs?: number;
  /** 사용자 메시지 최대 글자 수 (기본 2000) */
  maxUserChars?: number;
  /** 어시스턴트 메시지 최대 글자 수 (기본 2000) */
  maxAssistantChars?: number;
}

const DEFAULTS = {
  maxPairs: 10,
  maxUserChars: 2000,
  maxAssistantChars: 2000,
} as const;

export class ChatHistory {
  private store = new Map<string, ChatEntry[]>();
  private maxPairs: number;
  private maxUserChars: number;
  private maxAssistantChars: number;

  constructor(opts: ChatHistoryOptions = {}) {
    this.maxPairs = opts.maxPairs ?? DEFAULTS.maxPairs;
    this.maxUserChars = opts.maxUserChars ?? DEFAULTS.maxUserChars;
    this.maxAssistantChars = opts.maxAssistantChars ?? DEFAULTS.maxAssistantChars;
  }

  /** 대화 쌍 추가 (user + assistant) */
  add(channelId: string, userMsg: string, assistantMsg: string): void {
    const entries = this.store.get(channelId) ?? [];
    entries.push(
      { role: 'user', content: truncate(userMsg, this.maxUserChars) },
      { role: 'assistant', content: truncate(assistantMsg, this.maxAssistantChars) },
    );

    // 최대 N쌍 (2*N 엔트리) 유지
    const maxEntries = this.maxPairs * 2;
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }

    this.store.set(channelId, entries);
  }

  /** API 메시지 배열로 반환 (role: user/assistant) */
  toMessages(channelId: string): ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> {
    return this.store.get(channelId) ?? [];
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

/** 메시지 길이 제한 (뒤쪽 유지, 앞쪽 잘림) */
const truncate = (text: string, max: number): string => {
  if (text.length <= max) return text;
  return '…' + text.slice(-(max - 1));
};

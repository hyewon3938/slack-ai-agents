/** 생활 맥락 — 공용 타입. */

// ─── 타입 ───────────────────────────────────────────────

/** 맥락 생성 타이밍 */
export type ContextTiming = 'morning' | 'night' | 'conversation';

/** 날짜 파라미터 (한 번 계산, 서브 함수에 전달) */
export interface DateParams {
  today: string;
  yesterday: string;
  userId: number;
}

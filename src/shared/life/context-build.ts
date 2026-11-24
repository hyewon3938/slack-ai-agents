/** 생활 맥락 — 통합 빌더. */

import { getTodayISO, getYesterdayISO } from '../kst.js';
import type { ContextTiming, DateParams } from './context-types.js';
import { querySleepContext } from './context-sleep.js';
import {
  queryRoutineContext,
  queryScheduleContext,
  queryDiaryContext,
  queryLifeThemesContext,
  queryFortuneContext,
} from './context-sections.js';

// ─── 통합 빌더 ──────────────────────────────────────────

/**
 * 생활 맥락 텍스트를 생성한다.
 * 타이밍에 따라 데이터 부재 처리가 달라진다.
 * 데이터가 전혀 없으면 빈 문자열 반환.
 */
export const buildLifeContext = async (
  timing: ContextTiming = 'conversation',
  userId: number,
): Promise<string> => {
  try {
    const dates: DateParams = {
      today: getTodayISO(),
      yesterday: getYesterdayISO(),
      userId,
    };

    const [sleep, routine, schedule, diary, themes, fortune] = await Promise.all([
      querySleepContext(dates, timing),
      queryRoutineContext(dates, timing),
      queryScheduleContext(dates),
      queryDiaryContext(dates, timing),
      queryLifeThemesContext(userId),
      queryFortuneContext(dates),
    ]);

    const lines = [sleep, routine, schedule, diary, themes, fortune].filter(Boolean);
    if (lines.length === 0) return '';

    return `\n\n## 현재 생활 맥락\n${lines.join('\n')}`;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Life Context] 맥락 생성 실패:', msg);
    return '';
  }
};

/**
 * 매일 07시 패턴 일일 매칭 cron (08:03 일일 종합 인사이트 선행, #475 ADR-0031).
 * ADR-0017 + ADR-0026(pattern_* rename) + ADR-0033(매트릭=가설 재정의, #477 P1/P2) 참조.
 *
 * 흐름 (#477 P2 — transient 핸드오프):
 *   오늘 활성 시드 평가 → seed_daily_activations UPSERT ("오늘 발현 시드" 핸드오프 로그)
 *   → daily-insight(#insight 08:03)·saju_influence_summary recent tier·pillar-level이 소비.
 *
 * #477 P2: 검증(카운터 확정 + status 전이)은 주간 엔진(pattern-verification)이 raw 재계산.
 * 일별 백필·#life 한 줄 발송은 제거 — 이 cron은 "오늘"만 조용히 기록(Slack 발송 없음).
 */

import type { App } from '@slack/bolt';
import { matchAllSeedsForDay, recordDailyMatches } from '../shared/pattern-match.js';
import { getEffectiveTodayISO } from '../shared/kst.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import type { LifeCronConfig } from './life-cron.js';

/** 한 유저의 오늘 매칭 평가 + seed_daily_activations 기록 (Slack 발송 없음, 유저별 에러 격리). */
const matchAndRecordForUser = async (userId: number, date: string): Promise<void> => {
  try {
    const results = await matchAllSeedsForDay(userId, date);
    await recordDailyMatches(userId, date, results);
    const triggered = results.filter((r) => r.triggerActivated).length;
    console.warn(`[Pattern Match] user=${userId} date=${date} triggered=${triggered} (recorded)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Pattern Match] 매칭 실패 user=${userId} date=${date}: ${msg}`);
  }
};

/**
 * 패턴 일일 매칭 cron 본체. SLOT_TASKS에서 호출.
 * #477 P2: "오늘 발현 시드"만 seed_daily_activations에 transient 기록 (Slack 발송 없음).
 * (app/config는 SLOT_TASKS 시그니처 호환용 — 발송 경로 제거로 미사용.)
 */
export const dailyPatternMatchingTask = async (
  _app: App,
  _config: LifeCronConfig,
): Promise<void> => {
  const today = getEffectiveTodayISO();
  const mappings = await queryAllUserMappings();

  if (mappings.length === 0) {
    await matchAndRecordForUser(DEFAULT_USER_ID, today);
    return;
  }

  for (const mapping of mappings) {
    await matchAndRecordForUser(mapping.userId, today);
  }
};

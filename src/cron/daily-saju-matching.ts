/**
 * Phase 3 — 매일 09시 사주 일일 매칭 cron.
 * ADR-0017 + ADR-0026(pattern_* rename) 참조.
 *
 * 흐름:
 *   1) 어제 pending 매칭 verify_status 확정 (hit/miss/inconclusive)
 *   2) 오늘 활성 시드 평가 → pattern_matches UPSERT
 *   3) matched=true 시드를 #life 잔소리 끝 한 줄로 압축 전송
 */

import type { App } from '@slack/bolt';
import {
  matchAllSeedsForDay,
  recordDailyMatches,
  verifyDailyMatches,
  compactMatchedLine,
  getDailyContext,
} from '../shared/saju-match.js';
import { postToChannel } from '../shared/slack.js';
import { getEffectiveTodayISO } from '../shared/kst.js';
import { DEFAULT_USER_ID, queryAllUserMappings } from '../shared/user-resolver.js';
import { pickConfirmedHypothesisLines } from '../shared/insights.js';
import type { LifeCronConfig } from './life-cron.js';

export interface DailySajuMatchingResult {
  date: string;
  triggeredCount: number;
  matchedCount: number;
  line: string | null;
  hypothesisLines: string[];
}

/**
 * 매칭 평가만 수행 (Slack 전송 X). 테스트/디버깅용.
 */
export const runDailySajuMatchingDryRun = async (
  userId: number,
  date: string,
): Promise<DailySajuMatchingResult> => {
  const ctx = await getDailyContext(userId, date);
  if (!ctx) {
    return { date, triggeredCount: 0, matchedCount: 0, line: null, hypothesisLines: [] };
  }

  const results = await matchAllSeedsForDay(userId, date);
  await recordDailyMatches(userId, date, results);

  const triggeredCount = results.filter((r) => r.triggerActivated).length;
  const matchedCount = results.filter((r) => r.matched).length;
  const line = compactMatchedLine(ctx, results);
  const hypothesisLines = await pickConfirmedHypothesisLines(userId, date);

  return { date, triggeredCount, matchedCount, line, hypothesisLines };
};

/**
 * 한 유저 매칭 처리 (Slack 전송 포함).
 */
export const dailySajuMatchingForUser = async (
  app: App,
  userId: number,
  channelId: string,
  date: string,
): Promise<void> => {
  try {
    await verifyDailyMatches(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Saju Match] verify 실패 user=${userId}: ${msg}`);
  }

  let result: DailySajuMatchingResult;
  try {
    result = await runDailySajuMatchingDryRun(userId, date);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Saju Match] 매칭 실패 user=${userId}: ${msg}`);
    return;
  }

  console.warn(
    `[Saju Match] user=${userId} date=${date} triggered=${result.triggeredCount} matched=${result.matchedCount}`,
  );

  if (result.line) {
    try {
      await postToChannel(app.client, channelId, result.line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Saju Match] Slack 전송 실패 user=${userId}: ${msg}`);
    }
  }

  if (result.hypothesisLines.length > 0) {
    try {
      await postToChannel(app.client, channelId, result.hypothesisLines.join('\n'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Saju Match] 가설 라인 전송 실패 user=${userId}: ${msg}`);
    }
  }
};

/**
 * 사주 일일 매칭 cron 본체. SLOT_TASKS에서 호출.
 * #life 채널로 전송 (life channel mapping 사용).
 */
export const dailySajuMatchingTask = async (app: App, config: LifeCronConfig): Promise<void> => {
  const today = getEffectiveTodayISO();
  const mappings = await queryAllUserMappings();

  if (mappings.length === 0) {
    if (!config.channelId) return;
    await dailySajuMatchingForUser(app, DEFAULT_USER_ID, config.channelId, today);
    return;
  }

  for (const mapping of mappings) {
    const channelId = mapping.lifeChannelId ?? mapping.slackUserId;
    if (!channelId) continue;
    await dailySajuMatchingForUser(app, mapping.userId, channelId, today);
  }
};
